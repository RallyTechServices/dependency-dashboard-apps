Ext.define("TSDependencyTimeline", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },

    items: [
        {xtype:'container',itemId:'selector_box', region: 'north', layout: 'hbox'},
        {xtype:'container',itemId:'display_box', region: 'center', layout: 'fit'}
    ],

    integrationHeaders : {
        name : "TSDependencyTimeline"
    },
    
    clearText: '-- all releases --',
    PIs: [],
    MilestonesByOID: {}, 
    
    config: {
        defaultSettings: {
            typeField: null
        }
    },
    
    launch: function() {
        var me = this;
        if (Ext.isEmpty(this.getSetting('typeField')) ) {
            Ext.Msg.alert('Configuration...', 'Please go to Edit App Settings and choose a feature field used to define Platform or Business');
            return;
        }
        this.type_field = this.getSetting('typeField');
        
        this._addSelectors(this.down('#selector_box'));
    },
      
    _addSelectors: function(container) {
        
        container.add({ 
            xtype:'portfolioitempickerbutton',
            layout: 'hbox',
            listeners: {
                scope: this,
                itemschosen: function(picker,items) {
                    this.PIs = items;
                    this._changeReleaseBox();

                    if ( this.PIs.length > 0 ) {
                        this._updateData();
                    }
                    
                }
            }
        });
        
        container.add({
            xtype:'container',
            itemId:'release_box'
        });
        
        this._changeReleaseBox();
        
        var store = Ext.create('Rally.data.custom.Store',{
            xtype:'rallycustom',
            autoLoad: true,
            data: [
                { _refObjectName:'Size', _ref: 'size' },
                { _refObjectName:'Count',_ref: 'count'}
            ]
        });
        
        this.metric_selector = container.add({
            xtype:'rallycombobox',
            store: store,
            itemId: 'metric_selector',
            margin: '0 10 0 10',
            width: 100,
            stateful: true,
            stateId: 'techservices-timeline-metriccombo-1',
            stateEvents:['select','change'],
            listeners: {
                scope: this,
                change: this._updateData
            }
        });
        
       
    },
    
    _changeReleaseBox: function() {
        var container = this.down('#release_box');
        if ( Ext.isEmpty(container) ) { return; }
        container.removeAll();
        
        if ( this.PIs.length === 0 ) {
            container.add({ 
                xtype:'rallyreleasecombobox',
                fieldLabel: 'And/Or Step 2: Choose Business Release:',
                margins: '3 0 0 50',
                labelWidth: 215,
                width: 515,
                allowClear: true,
                clearText: this.clearText,
                getDefaultValue: function() {
                    return null;
                },
                listeners: {
                    scope: this,
                    change: this._updateData
                }
            });
            
            return;
        }
        
        
        this._getChildItems().then({
            scope: this,
            success: function(items) {
                var timebox_oids_by_name = {};
                Ext.Array.each(items, function(item) {
                    var release = item.get('Release');
                    if ( !Ext.isEmpty(release) ) {
                        timebox_oids_by_name[release.Name] = release.ObjectID;
                    }
                });
                
                var filters = Ext.Array.map(Ext.Object.getValues(timebox_oids_by_name), function(oid){
                    return { property:'ObjectID',value:oid };
                });
                
                if ( filters.length === 0 ) {
                    //container.add({xtype:'container', html:'No Releases on Features for This Item'});
                } else {
                    container.add({ 
                        xtype:'rallyreleasecombobox',
                        fieldLabel: 'And/Or Step 2: Choose Business Release:',
                        margins: '3 0 0 50',
                        labelWidth: 215,
                        width: 515,
                        allowClear: true,
                        clearText: this.clearText,
                        getDefaultValue: function() {
                            return null;
                        },
                        storeConfig: {
                            context: {
                                project: null
                            },
                            filters: Rally.data.wsapi.Filter.or(filters),
                            remoteFilter: true
                        },
                        listeners: {
                            scope: this,
                            change: this._updateData
                        }
                    });
                }
                
            },
            failure: function(msg) {
                
                Ext.Msg.alert('',msg);
            }
        });
    },
    
    _updateData: function() {
        var release = null;
        this.rows = [];
        this.base_features = [];
        this.baseItemsByOID = {};
        this.metric = this.metric_selector.getValue();
    
        this.down('#display_box').removeAll();

        if ( !Ext.isEmpty(this.down('rallyreleasecombobox') ) ) {
            release = this.down('rallyreleasecombobox').getRecord();
        }
        
        this.logger.log("_updateData", this.PIs, release);
        
        if ( ( Ext.isEmpty(release) || release.get('Name') == this.clearText ) && ( Ext.isEmpty(this.PIs) || this.PIs.length === 0 ) ) {
            return;
        }
        
        this.rows = [];
        
        Deft.Chain.pipeline([
            this._getChildItems,
            this._getRelatedItems,
            this._getParents
        ],this).then({
            scope: this,
            success: function(results) {
                if ( this.base_items.length === 0 ) { return; }
                
                var rows = this._makeRowsFromHash(this.baseItemsByOID);
                this._fetchMilestoneInformation(rows).then({
                    scope: this,
                    success: function(results) {
                        this.rows = results;
                        this._makeChart(this.rows);
                    },
                    failure: function(msg) {
                        Ext.Msg.alert('Problem getting milestone data', msg);
                    }
                });
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem Fetching Data', msg);
            }
        });
        
    },
    
    _getParentType: function() {
        if ( Ext.isEmpty(this.PIs) || this.PIs.length == 0 ) {
            return null;
        }
        
        return this.PIs[0].get('_type');
    },
    
    _getChildType: function(type) {
        var type_map = {
            'parent'                  : 'child',
            'portfolioitem/initiative': 'portfolioitem/Feature',
            'portfolioitem/theme'     : 'portfolioitem/Initiative'
        };
        
        return type_map[type] || 'hierarchicalrequirement';
    },
    
    _getChildItems: function() {
        if ( Ext.isEmpty(this.PIs) ) { this.PIs = []; }

        this.setLoading('Fetching child items...');
        
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
        
        var release = null;
        
        if ( !Ext.isEmpty(this.down('rallyreleasecombobox') ) ) {
            release = this.down('rallyreleasecombobox').getRecord();
        }
        
        var filters = null;

        var release_filter = null;
        if ( release && release.get('Name') != this.clearText ) {
            release_filter = Ext.create('Rally.data.wsapi.Filter',{
                property:'Release.Name',
                value: release.get('Name')
            });
            filters = release_filter;
        }
        
        var pi_filter_configs = Ext.Array.map(this.PIs, function(pi) {
            return [
                {property:'Parent.ObjectID',value:pi.get('ObjectID')}
            ];
        });
        
        var pi_filters = null;
        if ( pi_filter_configs.length > 0 ) {
            pi_filters = Rally.data.wsapi.Filter.or(Ext.Array.flatten(pi_filter_configs));
            filters = pi_filters;
            if ( !Ext.isEmpty(release_filter) ) {
                filters = release_filter.and(pi_filters);
            }
        }
        
        if ( Ext.isEmpty(filters) ) { return []; }

        filters = filters.and(Ext.create('Rally.data.wsapi.Filter',{property:this.type_field, value:'Business'}));
        
        var config = {
            model: this._getChildType(this._getParentType()),
            filters: filters,
            context: { project: null },
            fetch: ['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate',
                'PlannedEndDate','PlannedStartDate','ActualStartDate','ActualEndDate',
                'Project','Owner','Release','Milestones',
                'TargetDate',me.type_field,
                'LeafStoryCount','State','LeafStoryPlanEstimateTotal',
                'AcceptedLeafStoryCount','State','AcceptedLeafStoryPlanEstimateTotal',
                'UnEstimatedLeafStoryCount']
        }
        
        this._loadWsapiRecords(config).then({
            scope: this,
            success: function(items) {
                deferred.resolve(items);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        }).always(function() { me.setLoading(false); });
        
        return deferred.promise;
    },
    
    _getRelatedItems: function(base_items) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        this.setLoading('Fetching predecessors/successors...');
        this.base_items = base_items;
        
        if ( this.base_items.length === 0 ) {
            Ext.Msg.alert('','No Children Found');
            this.setLoading(false);
            return [];
        }
        var promises = [];
        this.baseItemsByOID = {};
        
        Ext.Array.each(base_items, function(item){
            this.baseItemsByOID[item.get('ObjectID')] = item;
            promises.push(function() { return this._getPredecessors(item); });
            promises.push(function() { return this._getSuccessors(item); });
        },this);
        
        Deft.Chain.sequence(promises,this).then({
            scope: this,
            success: function(results) {
                var related_items = Ext.Array.flatten(results);
                
                deferred.resolve(related_items);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        }).always(function() { me.setLoading(false); });
        
        return deferred.promise;
    },
    
    // getting the parents lets us get the grandparents
    _getParents: function(leaf_items) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
                    
        if ( this.base_items.length === 0 ) { return; }
        
        var oids = [];
        Ext.Object.each(this.baseItemsByOID, function(key,item){
            var parent_oid = item.get('Parent') && item.get('Parent').ObjectID;
            if ( !Ext.isEmpty(parent_oid) ) {
                oids.push(parent_oid);
            }
        });
        
        Ext.Array.each(leaf_items, function(item){
            var parent_oid = item.get('Parent') && item.get('Parent').ObjectID;
            if ( !Ext.isEmpty(parent_oid) ) {
                oids.push(parent_oid);
            }
        });
        
        var filters = Ext.Array.map(Ext.Array.unique(oids), function(oid){
            return { property:'ObjectID',value:oid};
        });
        
        var config = {
            model: this._getParentType(),
            filters: Rally.data.wsapi.Filter.or(filters),
            context: { project: null },
            fetch:['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate','Milestones',
                'TargetDate','PlannedEndDate','PlannedStartDate','ActualStartDate','ActualEndDate',
                'Project','Owner','Release',me.type_field,
                'LeafStoryCount','State','LeafStoryPlanEstimateTotal',
                'AcceptedLeafStoryCount','State','AcceptedLeafStoryPlanEstimateTotal',
                'UnEstimatedLeafStoryCount']
        };
        
        this._loadWsapiRecords(config).then({
            success: function(results) {
                me.parentsByOID = {};
                Ext.Array.each(results, function(result){
                    var oid = result.get('ObjectID');
                    var data = result.getData();
                    me.parentsByOID[oid] = data;
                });
                
                deferred.resolve(leaf_items);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        
        return deferred.promise;
        
    },
    
    _getPredecessors: function(item) {
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
            
        if ( item.get('Predecessors').Count === 0 ) {
            item.set('_predecessors', []);
            return [];
        }
        
        item.getCollection('Predecessors').load({
            fetch: ['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate','Milestones','State',
                'TargetDate','PlannedEndDate','PlannedStartDate','ActualStartDate','ActualEndDate',
                'Project','Owner','Release',
                'AcceptedLeafStoryCount','State','AcceptedLeafStoryPlanEstimateTotal',
                'UnEstimatedLeafStoryCount'],
            scope: this,
            filters: [Ext.create('Rally.data.wsapi.Filter',{property:this.type_field, operator:'!=', value:'Business'})],
            callback: function(records, operation, success) {
                item.set('_predecessors', records);
                deferred.resolve(records);
            }
        });
        
        return deferred.promise;
    },
    
    _getSuccessors: function(item) {
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
            
        if ( item.get('Successors').Count === 0 ) {
            item.set('_successors', []);
            return [];
        }
        
        item.getCollection('Successors').load({
            fetch: ['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate','Milestones','State',
                'TargetDate','PlannedEndDate','PlannedStartDate','ActualStartDate','ActualEndDate',
                'Project','Owner','Release',
                'AcceptedLeafStoryCount','State','AcceptedLeafStoryPlanEstimateTotal',
                'UnEstimatedLeafStoryCount'], 
            scope: this,
            filters: [Ext.create('Rally.data.wsapi.Filter',{property:this.type_field, operator:'!=', value:'Business'})],
            callback: function(records, operation, success) {
                item.set('_successors', records);
                deferred.resolve(records);
            }
        });
        
        return deferred.promise;
    },
    
    _makeRowsFromHash: function(base_items_by_oid){
        var me = this,
            rows = [];
            
        if ( !Ext.isEmpty(this.down('rallyreleasecombobox') ) ) {
            var release = this.down('rallyreleasecombobox').getRecord();
            if ( release && release.get('Name') != this.clearText ) {
                rows.push(Ext.create('CA.techservices.row.DependencyRow', Ext.Object.merge({
                        _Level: 0
                    }, release.getData() )
                ));
            }
        }

        Ext.Object.each(base_items_by_oid, function(oid,item){
            var parent_oid = item.get('Parent') && item.get('Parent').ObjectID;
            var grandparent = null;
            
            if ( !Ext.isEmpty(parent_oid) && !Ext.isEmpty(me.parentsByOID[parent_oid]) && !Ext.isEmpty(me.parentsByOID[parent_oid].Parent)) {
                grandparent = me.parentsByOID[parent_oid].Parent;
            }
                       
            var business_item = Ext.create('CA.techservices.row.DependencyRow', Ext.Object.merge({
                    _Level: 2,
                    Grandparent: grandparent,
                    //Parent: item.get('Parent'),
                    BusinessItem: item.getData()
                }, item.getData() )
            );
            
            rows.push(business_item);
            
            var dependencies = Ext.Array.push(item.get('_predecessors') || [], item.get('_successors') || [] );
            Ext.Array.each(dependencies, function(dependency){
                var parent_oid = dependency.get('Parent') && dependency.get('Parent').ObjectID;
                
                grandparent = null;

                if ( !Ext.isEmpty(parent_oid) && !Ext.isEmpty(me.parentsByOID[parent_oid]) && !Ext.isEmpty(me.parentsByOID[parent_oid].Parent)) {
                    grandparent = me.parentsByOID[parent_oid].Parent;
                }
//                
                var related_record = Ext.create('CA.techservices.row.DependencyRow', Ext.Object.merge({
                        _Level: 3,
                        Grandparent: grandparent,
                        //Parent: item.get('Parent'),
                        BusinessItem: item.getData()
                    }, dependency.getData() )
                );
//                
                business_item.addRelatedRecord(related_record);
                rows.push(related_record);
            });            

        });
        
        return rows;
    },
    
    _fetchMilestoneInformation: function(rows) {
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
        this.setLoading('Fetching Milestone Information...');
        
        var milestone_oids = [-1];
        
        if ( rows.length > 0 ) {
            milestone_oids = Ext.Array.unique(
                Ext.Array.flatten(
                    Ext.Array.map(rows, function(row){
                        var row_ms = row.get('Milestones');
                    
                        if ( Ext.isEmpty(row_ms) || row_ms.Count === 0 || row_ms._tagsNameArray.length === 0 ) {
                            return -1;
                        }
                        return Ext.Array.map(row_ms._tagsNameArray, function(tag){
                            return me._getOidFromRef(tag._ref);
                        });
                    })
                )
            );
        }
                
        var config = {
            model:'Milestone',
            filters: Rally.data.wsapi.Filter.or(
                Ext.Array.map(milestone_oids, function(oid){
                    return { property:'ObjectID',value:oid };
                })
            ),
            limit: Infinity,
            fetch: ['TargetDate','Name','ObjectID']
        };
        
        this._loadWsapiRecords(config).then({
            scope: this,
            success: function(results) {
                me.MilestonesByOID = {};
                Ext.Array.each(results, function(result){
                    me.MilestonesByOID[result.get('ObjectID')] = result;
                });
                
                me.milestoneLines = [];
                
                Ext.Array.each(results, function(milestone){
                    
                    me.milestoneLines.push({
                        color: '#0c0',
                        width: 3,
                        date: milestone.get('TargetDate'),
                        dashStyle: 'shortdash',
                        zIndex: 4
                    
                    });
                });
                
                Ext.Array.each(rows, function(row) {
                    var item_milestones = [];
                    
                    Ext.Array.each( row.get('Milestones')._tagsNameArray || [], function(ms){
                        var ref = ms._ref;
                        var ms_oid = me._getOidFromRef(ref);
                        if ( me.MilestonesByOID[ms_oid]  ) {
                            item_milestones.push(me.MilestonesByOID[ms_oid].getData());
                        }
                    });
                    row.set('__Milestones',item_milestones);
                });
                deferred.resolve(rows);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        }).always(function() { me.setLoading(false); });
        
        return deferred.promise;
    },
    
    _loadWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        var default_config = {
            model: 'Defect',
            fetch: ['ObjectID']
        };
        this.logger.log("Starting load:",config.model);
        Ext.create('Rally.data.wsapi.Store', Ext.Object.merge(default_config,config)).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(records);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },
        
    _makeChart: function(rows) {
        this.down('#display_box').removeAll();

        this.down('#display_box').add(this._getChartConfig(rows));
    },
    
    getCategoryHeader: function(){
        var html = "<table><tr>";
        
        Ext.Array.each(Rally.getApp()._getCategoryColumns(), function(column){
            var style = column.style;
            var string = column.text;
            
            html += Ext.String.format("<td class='ts-timeline-category-cell' style='{0}'>{1}</td>",
                style,
                string
            );
        });
        
        html += "</tr></table>";

        return html;
    },
    
    getCategoryString: function(record) {
        var html = "<table><tr>";
        
        Ext.Array.each(Rally.getApp()._getCategoryColumns(), function(column){
            var style = column.style;
            var value = record.get(column.dataIndex);
            var string = column.renderer(value,null,record);
            
            html += Ext.String.format("<td class='ts-timeline-category-cell' style='{0}'>{1}</td>",
                style,
                string
            );
        });
        html += "</tr></table>";

        return html;
    },
    
    _getCategoryColumns: function() {
        var columns = [
            {
                dataIndex: 'ObjectID',
                text: 'Portfolio Item',
                style: "width:300px",
                renderer: function(value,meta,record) {
                    var record_type = record.get('_type');
                    
                    var string = record.get('Name');
                    
                    if ( record_type !== 'release' ) {
                        string = Ext.String.format( '<a href="{0}" target="blank">{1}</a>: {2}',
                            Rally.nav.Manager.getDetailUrl(record),
                            record.get('FormattedID'),
                            record.get('Name')
                        );
                    }
                    
                    var level = record.get('_Level') || 0;
                   
                    if ( level == 2 ) {
                        //string = "<span style='background-color:#e7f5fe;font-weight:bold;'>" + string + "</span>";
                        string = "<span style='font-weight:bold;'>" + string + "</span>";
                    } 
                    
                    var prefix = Ext.String.repeat('&nbsp;&nbsp&nbsp;', level);
                    
                    return prefix + string;
                }
            },
            {
                dataIndex: 'Project',
                text: 'Project',
                style: "width:100px",
                renderer: function(value,meta,record) {
                    if ( Ext.isEmpty(value) ) { return ""; }
                    var string = value._refObjectName;

                    var level = record.get('_Level') || 0;
                   
                    if ( level == 2 ) {
                        string = "<span style='font-weight:bold;'>" + string + "</span>";
                    } 
                    
                    return string;
                }
            },
            {
                dataIndex: 'Owner',
                text: 'Owner',
                style: "width:75px",
                renderer: function(value,meta,record) {
                    if ( Ext.isEmpty(value) ) { return ""; }
                    var string = value._refObjectName;

                    var level = record.get('_Level') || 0;
                   
                    if ( level == 2 ) {
                        string = "<span style='font-weight:bold;'>" + string + "</span>";
                    } 
                    
                    return string;
                }
            }
        ];
        
        return columns;
    },
    
    _getChartConfig: function(rows) {
        var me = this;
        
        var config = {
            xtype: 'tsalternativetimeline',
            //height: 500,
            allowVerticalScroll: false,
            width: this.getWidth() - 20,
            verticalLabelWidth: 500,
            records: rows,
            pageSize: 7,
            getCategoryString: me.getCategoryString,
            getCategoryHeader: me.getCategoryHeader,
            additionalPlotlines: [], //this.milestoneLines,
            actualStartField: '__ActualStartDate',
            actualEndField: '__ActualEndDate',
            percentDoneField: this.metric == 'count' ? '__PercentDoneByStoryCount':'__PercentDoneByStoryPlanEstimate',

            eventsForPlannedItems: {
                
                click: function(evt) {
                    
                    if ( this._record._type != 'release' && this._record._type != 'iteration' ) {
                        

                        var pop = Ext.create('CA.techservices.popover.TimelinePopover', {
                            target: Ext.get(evt.target),//Ext.get(evt.target.graphic.element),
                            delegate: '.mySelectorForAllTargets'
                        });
                                        
                        pop.updateContent(this._record);
                    }
                }
            },
            eventsForActualItems: {
                click: function(evt) {
                    //Rally.nav.Manager.showDetail(this._record._ref);
                    if ( this._record._type != 'release' && this._record._type != 'iteration' ) {
                        

                        var pop = Ext.create('CA.techservices.popover.TimelinePopover', {
                            target: Ext.get(evt.target),//Ext.get(evt.target.graphic.element),
                            delegate: '.mySelectorForAllTargets'
                        });
                                        
                        pop.updateContent(this._record);
                    }
                }
            }
        };
        
        var start_date = this._getStartDate();
        if ( !Ext.isEmpty(start_date) ) { config.chartStartDate = start_date; }
        
        var end_date = this._getEndDate();
        if ( !Ext.isEmpty(end_date) ) { config.chartEndDate = end_date; }

        return config;
    },
    
    _getStartDate: function() {
        var earliest_pi_start = null,
            release_start = null;
        Ext.Array.each(this.rows, function(pi){
            if ( Ext.isEmpty(pi.get('PlannedStartDate')) ) { return; }
            if ( Ext.isEmpty(earliest_pi_start) ) { earliest_pi_start = pi.get('PlannedStartDate'); }
            if ( earliest_pi_start > pi.get('PlannedStartDate') ) { earliest_pi_start = pi.get('PlannedStartDate'); }
            
        });
        
        var start = null;
        if ( !Ext.isEmpty(earliest_pi_start) ) { start = earliest_pi_start; }
        
        var release = this.down('rallyreleasecombobox') && this.down('rallyreleasecombobox').getRecord();
        if ( !Ext.isEmpty(release) && !Ext.isEmpty(release.get('ReleaseStartDate')) ) {
            release_start = release.get('ReleaseStartDate');
            if ( Ext.isEmpty(start) ) { start = release_start; }
            if ( release_start < start ) { start = release_start; }
        }
                
        return start;
    },
    
    _getEndDate: function() {
        var latest_pi_end = null,
            release_end = null;
        Ext.Array.each(this.rows, function(pi){
            if ( Ext.isEmpty(pi.get('PlannedEndDate')) ) { return; }
            if ( Ext.isEmpty(latest_pi_end) ) { latest_pi_end = pi.get('PlannedStartDate'); }
            if ( latest_pi_end < pi.get('PlannedEndDate') ) { latest_pi_end = pi.get('PlannedEndDate'); }
            
        });
        
        var end = null;
        if ( !Ext.isEmpty(latest_pi_end) ) { end = latest_pi_end; }
        
        var release = this.down('rallyreleasecombobox') && this.down('rallyreleasecombobox').getRecord();
        if ( !Ext.isEmpty(release) && !Ext.isEmpty(release.get('ReleaseDate')) ) {
            release_end = release.get('ReleaseDate');
            if ( Ext.isEmpty(end) ) { end = release_end; }
            if ( release_end > end ) { end = release_end; }
        }
                
        return end;
    },
    
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    _getOidFromRef: function(ref) {
        var ref_array = ref.replace(/\.js$/,'').split(/\//);
        return ref_array[ref_array.length-1];
    },
    
    getSettingsFields: function() {
        return [{
            name: 'typeField',
            xtype: 'rallyfieldcombobox',
            model: 'PortfolioItem',
            _isNotHidden: function(field) {
                if ( field.hidden ) { return false; }
                var defn = field.attributeDefinition;
                if ( Ext.isEmpty(defn) ) { return false; }
                
                return ( defn.Constrained && defn.AttributeType == 'STRING' );
            }
        }];
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    }
});
