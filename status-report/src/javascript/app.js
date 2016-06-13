Ext.define("TSDependencyStatusReport", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    
    layout: 'border',
    
    items: [
        {xtype:'container',itemId:'selector_box', region: 'north', layout: 'hbox'},
        {xtype:'container',itemId:'display_box', region: 'center', layout: 'fit'}
    ],
    
    clearText: '-- all releases --',
    PIs: [],
    MilestonesByOID: {},
    
    integrationHeaders : {
        name : "TSDependencyStatusReport"
    },
    
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
        this._addExportButton(this.down('#selector_box'));
    },
      
    _addSelectors: function(container) {
        container.add({ 
            xtype:'portfolioitempickerbutton',
            layout: 'hbox',
            listeners: {
                scope: this,
                itemschosen: function(picker,items) {
                    this.PIs = items;
                    if ( this.PIs.length > 0 ) {
                        this._updateData();
                    }
                    
                    this._changeReleaseBox();
                }
            }
        });
        
        container.add({
            xtype:'container',
            itemId:'release_box'
        });
        
        this._changeReleaseBox();
       
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
        
        this._getChildFeatures().then({
            scope: this,
            success: function(features) {
                var timebox_oids_by_name = {};
                Ext.Array.each(features, function(feature) {
                    var release = feature.get('Release');
                    if ( !Ext.isEmpty(release) ) {
                        timebox_oids_by_name[release.Name] = release.ObjectID;
                    }
                });
                
                var filters = Ext.Array.map(Ext.Object.getValues(timebox_oids_by_name), function(oid){
                    return { property:'ObjectID',value:oid };
                });
                
                if ( filters.length === 0 ) {
                    container.add({xtype:'container', html:'No Releases on Features for This Item'});
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
    
    _addExportButton: function(container) {
        container.add({xtype:'container',flex: 1});
        
        container.add({
            xtype:'rallybutton',
            itemId:'export_button',
            cls: 'secondary',
            text: '<span class="icon-export"> </span>',
            disabled: true,
            listeners: {
                scope: this,
                click: function() {
                    this._export();
                }
            }
        });
    },
    
    _updateData: function() {
        this.down('#export_button').setDisabled(true);
        this.down('#display_box').removeAll();
        
        var release = null;
        
        if ( !Ext.isEmpty(this.down('rallyreleasecombobox') ) ) {
            release = this.down('rallyreleasecombobox').getRecord();
        }
        
        this.logger.log("_updateData", this.PIs, release);
        
        if ( ( Ext.isEmpty(release) || release.get('Name') == this.clearText ) && ( Ext.isEmpty(this.PIs) || this.PIs.length === 0 ) ) {
            return;
        }
        
        this.rows = [];
        
        Deft.Chain.pipeline([
            this._getChildFeatures,
            this._getRelatedFeatures,
            this._getParents
        ],this).then({
            scope: this,
            success: function(results) {
                if ( this.base_features.length === 0 ) { return; }
                                
                var rows = this._makeRowsFromHash(this.baseFeaturesByOID);
                this._fetchMilestoneInformation(rows).then({
                    scope: this,
                    success: function(results) {
                        this.rows = results;
                        this._makeGrid(this.rows);
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
    
    _getChildFeatures: function() {
        if ( Ext.isEmpty(this.PIs) ) { this.PIs = []; }

        this.setLoading('Fetching descendant features...');
        
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
                {property:'Parent.ObjectID',value:pi.get('ObjectID')},
                {property:'Parent.Parent.ObjectID',value:pi.get('ObjectID')}
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
            model: 'PortfolioItem/Feature',
            filters: filters,
            context: { project: null },
            fetch: ['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate',
                'PlannedEndDate','PlannedStartDate','Project','Owner','Release','Milestones',
                'TargetDate',me.type_field,
                'LeafStoryCount','State','LeafStoryPlanEstimateTotal']
        }
        
        this._loadWsapiRecords(config).then({
            scope: this,
            success: function(features) {
                this.logger.log("First level features:", features);
                deferred.resolve(features);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        }).always(function() { me.setLoading(false); });
        
        return deferred.promise;
    },
    
    _getRelatedFeatures: function(base_features) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        this.setLoading('Fetching predecessors/successors...');
        this.base_features = base_features;
        
        if ( this.base_features.length === 0 ) {
            Ext.Msg.alert('','No Features Found');
            this.setLoading(false);
            return [];
        }
        var promises = [];
        this.baseFeaturesByOID = {};
        
        Ext.Array.each(base_features, function(feature){
            this.baseFeaturesByOID[feature.get('ObjectID')] = feature;
            promises.push(function() { return this._getPredecessors(feature); });
            promises.push(function() { return this._getSuccessors(feature); });
        },this);
        
        Deft.Chain.sequence(promises,this).then({
            scope: this,
            success: function(results) {
                this.relatedFeatures = Ext.Array.flatten(results);
                
                this.logger.log("RETURNED:", this.relatedFeatures);
                this.logger.log('Base Features', this.baseFeaturesByOID);
                deferred.resolve(this.relatedFeatures);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        }).always(function() { me.setLoading(false); });
        
        return deferred.promise;
    },
    
    // getting the parents lets us get the grandparents
    _getParents: function(leaf_features) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
                    
        if ( this.base_features.length === 0 ) { return; }
        
        var oids = [];
        Ext.Object.each(this.baseFeaturesByOID, function(key,feature){
            var parent_oid = feature.get('Parent') && feature.get('Parent').ObjectID;
            if ( !Ext.isEmpty(parent_oid) ) {
                oids.push(parent_oid);
            }
        });
        
        Ext.Array.each(leaf_features, function(feature){
            var parent_oid = feature.get('Parent') && feature.get('Parent').ObjectID;
            if ( !Ext.isEmpty(parent_oid) ) {
                oids.push(parent_oid);
            }
        });
        
        var filters = Ext.Array.map(Ext.Array.unique(oids), function(oid){
            return { property:'ObjectID',value:oid};
        });
        
        var config = {
            model:'PortfolioItem/Initiative',
            filters: Rally.data.wsapi.Filter.or(filters),
            context: { project: null },
            fetch:['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate','Milestones',
                'TargetDate','PlannedEndDate','PlannedStartDate','Project','Owner','Release',me.type_field,
                'LeafStoryCount','State','LeafStoryPlanEstimateTotal']
        };
        
        this._loadWsapiRecords(config).then({
            success: function(results) {
                me.parentsByOID = {};
                Ext.Array.each(results, function(result){
                    var oid = result.get('ObjectID');
                    var data = result.getData();
                    me.parentsByOID[oid] = data;
                });
                
                deferred.resolve(leaf_features);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        
        return deferred.promise;
        
    },
    
    _getPredecessors: function(feature) {
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
            
        this.logger.log('Finding predecessors for', feature.get('FormattedID'));
        if ( feature.get('Predecessors').Count === 0 ) {
            feature.set('_predecessors', []);
            return [];
        }
        
        feature.getCollection('Predecessors').load({
            fetch: ['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate','Milestones',
                'TargetDate','PlannedEndDate','PlannedStartDate','Project','Owner','Release'],
            scope: this,
            filters: Ext.create('Rally.data.wsapi.Filter',{property:this.type_field, operator:'!=', value:'Business'}),
            callback: function(records, operation, success) {
                feature.set('_predecessors', records);
                deferred.resolve(records);
            }
        });
        
        return deferred.promise;
    },
    
    _getSuccessors: function(feature) {
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
            
        this.logger.log('Finding successors for', feature.get('FormattedID'));
        if ( feature.get('Successors').Count === 0 ) {
            feature.set('_successors', []);
            return [];
        }
        
        feature.getCollection('Successors').load({
            fetch: ['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate',
                'PlannedEndDate','PlannedStartDate','Project','Owner','Release'],
            scope: this,
            filters: Ext.create('Rally.data.wsapi.Filter',{property:this.type_field, value:'Platform'}),
            callback: function(records, operation, success) {
                feature.set('_successors', records);
                deferred.resolve(records);
            }
        });
        
        return deferred.promise;
    },
    
    _makeRowsFromHash: function(base_features_by_oid){
        var me = this,
            rows = [];
        // this.parentsByOID
        
        Ext.Object.each(base_features_by_oid, function(oid,feature){
            var initiative_oid = feature.get('Parent') && feature.get('Parent').ObjectID;
            var theme = null;
            var theme_fid = null;
            var theme_name = null;
            if ( !Ext.isEmpty(initiative_oid) && !Ext.isEmpty(me.parentsByOID[initiative_oid]) && !Ext.isEmpty(me.parentsByOID[initiative_oid].Parent)) {
                theme_fid = me.parentsByOID[initiative_oid].Parent.FormattedID;
                theme_name = me.parentsByOID[initiative_oid].Parent.Name;
                theme = me.parentsByOID[initiative_oid].Parent;
            }
            var row = Ext.Object.merge({
                _level: 0,
                _theme: theme,
                _theme_fid: theme_fid,
                _theme_name: theme_name,
                _initiative_fid: feature.get('Parent') && feature.get('Parent').FormattedID,
                _initiative_name: feature.get('Parent') && feature.get('Parent').Name,
                _initiative: feature.get('Parent')
            }, feature.getData());
            
            rows.push(row);
            
            Ext.Array.each(feature.get('_predecessors'), function(dependency){
                var initiative_oid = dependency.get('Parent') && dependency.get('Parent').ObjectID;
                theme = null;
                theme_fid = null;
                theme_name = null;
                if ( !Ext.isEmpty(initiative_oid) && !Ext.isEmpty(me.parentsByOID[initiative_oid]) && !Ext.isEmpty(me.parentsByOID[initiative_oid].Parent)) {
                    theme_fid = me.parentsByOID[initiative_oid].Parent.FormattedID;
                    theme_name = me.parentsByOID[initiative_oid].Parent.Name;
                    theme = me.parentsByOID[initiative_oid].Parent;
                }
                
                rows.push(Ext.Object.merge({
                    _level: 1,
                    _theme: theme,
                    _theme_fid: theme_fid,
                    _theme_name: theme_name,
                    _initiative_fid: dependency.get('Parent') && dependency.get('Parent').FormattedID,
                    _initiative_name: dependency.get('Parent') && dependency.get('Parent').Name,
                    _initiative: feature.get('Parent')
                }, dependency.getData()));
            });
            
            Ext.Array.each(feature.get('_successors'), function(dependency){
                var initiative_oid = dependency.get('Parent') && dependency.get('Parent').ObjectID;
                theme = null;
                theme_fid = null;
                theme_name = null;
                if ( !Ext.isEmpty(initiative_oid) && !Ext.isEmpty(me.parentsByOID[initiative_oid]) && !Ext.isEmpty(me.parentsByOID[initiative_oid].Parent)) {
                    theme_fid = me.parentsByOID[initiative_oid].Parent.FormattedID;
                    theme_name = me.parentsByOID[initiative_oid].Parent.Name;
                    theme = me.parentsByOID[initiative_oid].Parent;
                }
                rows.push(Ext.Object.merge({
                    _level: 1,
                    _theme: theme,
                    _theme_fid: theme_fid,
                    _theme_name: theme_name,
                    _initiative_fid: dependency.get('Parent') && dependency.get('Parent').FormattedID,
                    _initiative_name: dependency.get('Parent') && dependency.get('Parent').Name,
                    _initiative: feature.get('Parent')
                }, dependency.getData()));
            });
        });
        return rows;
    },
    
    _fetchMilestoneInformation: function(rows) {
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
        this.setLoading('Fetching Milestone Information...');
        this.logger.log('Finding milestones from rows:', rows);
        
        var milestone_oids = [-1];
        
        if ( rows.length > 0 ) {
            milestone_oids = Ext.Array.unique(
                Ext.Array.flatten(
                    Ext.Array.map(rows, function(row){
                        me.logger.log('--', row, row.Milestones);
                    
                        if ( Ext.isEmpty(row.Milestones) || row.Milestones.Count === 0 || row.Milestones._tagsNameArray.length === 0 ) {
                            return -1;
                        }
                        return Ext.Array.map(row.Milestones._tagsNameArray, function(tag){
                            return me._getOidFromRef(tag._ref);
                        });
                    })
                )
            );
        }
        
        this.logger.log('Milestone OIDs:', milestone_oids);
        
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
                
                deferred.resolve(rows);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        }).always(function() { me.setLoading(false); });
        
        return deferred.promise;
    },
    
    _makeGrid: function(rows) {
        var me = this,
            container = this.down('#display_box');
            
        container.removeAll();
        
        var store = Ext.create('Rally.data.custom.Store',{ data: rows});
        
        container.add({
            xtype:'rallygrid',
            store: store,
            columnCfgs: this._getColumns(),
            showRowActionsColumn: false,
            viewConfig: {
                listeners: {
                    refresh: function(view){
                        var nodes = view.getNodes();
                        for (var i = 0; i < nodes.length; i++) {
                            
                            var node = nodes[i];
                            
                            // get node record
                            var record = view.getRecord(node);
                            
                            // get color from record data
                            var color = '#fff';
                            if ( record.get(me.type_field) == "Business" ) {
                                color = "#e7f5fe";
                            }
                            
                            // get all td elements
                            var cells = Ext.get(node).query('td');  
                            
                            // set bacground color to all row td elements
                            for(var j = 0; j < cells.length; j++) {
                                Ext.fly(cells[j]).setStyle('background-color', color);
                            }                                       
                        }
                    }
                }
            }
        });
        
        this.down('#export_button').setDisabled(false);
    },
    
    _getColumns: function() {
        var columns = [],
            me = this;

        columns.push({
            dataIndex:'_theme_fid',
            text:'Theme ID',
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) {
                    return "";
                }
                return Ext.String.format("<a href='{0}' target='_blank'>{1}</a>",
                    Rally.nav.Manager.getDetailUrl(record.get('_theme')),
                    value
                );
            }
        });
        columns.push({dataIndex:'_theme_name',text:'Theme Name'});

        columns.push({
            dataIndex:'_initiative_fid',
            text:'Initiative ID',
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) {
                    return "";
                }
                return Ext.String.format("<a href='{0}' target='_blank'>{1}</a>",
                    Rally.nav.Manager.getDetailUrl(record.get('_initiative')),
                    value
                );
            }
        });
        
        columns.push({dataIndex:'_initiative_name',text:'Initiative Name'});
        
        columns.push({
            dataIndex:'FormattedID',
            text:'Feature ID',
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) {
                    return "";
                }
                return Ext.String.format("<a href='{0}' target='_blank'>{1}</a>",
                    Rally.nav.Manager.getDetailUrl(record),
                    value
                );
            }
        });
        columns.push({dataIndex:'Name',text:'Feature Name'});
        columns.push({
            dataIndex:me.type_field, 
            text: 'Type',
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) {
                    return "Platform";
                }
                
                return value;
            }
            
        });
        columns.push({
            dataIndex:'State', 
            text: 'State',
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) {
                    return "";
                }
                
                return value._refObjectName;
            }
            
        });
        columns.push({
            dataIndex:'PercentDoneByStoryCount',
            text: '% Complete by Story Count',
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) { return ""; }
                return Ext.String.format('{0}%', 100 * value);
            }
        });
        columns.push({
            dataIndex:'PercentDoneByStoryPlanEstimate',
            text: '% Complete by Story Points',
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) { return ""; }
                return Ext.String.format('{0}%', 100 * value);
            }
        });
        columns.push({dataIndex:'LeafStoryCount',text:'Leaf Story Count'});
        columns.push({dataIndex:'LeafStoryPlanEstimateTotal',text:'Leaf Story Plan Estimate Total'});
        
        columns.push({
            dataIndex:'Project',
            text:'Team', 
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) { return "--"; }
                return value._refObjectName;
            }
        });
        columns.push({
            dataIndex:'Owner',
            text:'Feature Owner', 
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) { return "--"; }
                return value._refObjectName;
            }
        });
        columns.push({
            dataIndex:'Release',
            text:'Release', 
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) ) { return "--"; }
                return value._refObjectName;
            }
        });
        
        columns.push({
            dataIndex:'PlannedStartDate',
            text: 'Planned Start Date',
            renderer: function(value,meta,record) {
                if ( Ext.isEmpty(value) ) { return ""; }
                return Ext.Date.format(value, 'd-M-Y T');
            }
        });
        columns.push({
            dataIndex:'PlannedEndDate',
            text: 'Planned End Date',
            renderer: function(value,meta,record) {
                if ( Ext.isEmpty(value) ) { return ""; }
                return Ext.Date.format(value, 'd-M-Y T');
            }
        });
        columns.push({
            dataIndex:'Milestones',
            text: 'Milestones', 
            renderer: function(value,meta,record){
                if ( Ext.isEmpty(value) || value.Count === 0 ) {
                    return "";
                }
                
                return Ext.Array.map(value._tagsNameArray, function(ms){
                    var oid = me._getOidFromRef(ms._ref);
                    var d = me.MilestonesByOID[oid] &&  me.MilestonesByOID[oid].get('TargetDate');
                    
                    if ( !Ext.isEmpty(d) ) {
                        d = Ext.Date.format(d, 'd-M-Y T');
                    }
                    return Ext.String.format("{0} - {1}",
                        ms.Name,
                        d
                    );
                }).join(', ');
            }
        });

        return columns;
    },
    
    _loadWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        var default_config = {
            model: 'Defect',
            fetch: ['ObjectID'],
            compact: false
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
    
    _displayGrid: function(store,field_names){
        this.down('#display_box').add({
            xtype: 'rallygrid',
            store: store,
            columnCfgs: field_names
        });
    },
    
    _export: function(){
        var me = this;
        this.logger.log('_export');
       
        var grid = this.down('rallygrid');
        var rows = this.rows;
                
        this.logger.log('number of rows:', rows.length);
        
        if (!rows ) { return; }
        
        var store = Ext.create('Rally.data.custom.Store',{ data: rows });
        
        if ( !grid ) {
            grid = Ext.create('Rally.ui.grid.Grid',{
                store: store,
                columnCfgs: [{
                    dataIndex: 'FormattedID',
                    text: 'ID'
                },
                {
                    dataIndex: 'Name',
                    text: 'Name'
                },
                {
                    dataIndex: 'Project',
                    text: 'Project',
                    renderer: function(value,meta,record){
                        if ( Ext.isEmpty(value) ) { 
                            return "";
                        }
                        return value._refObjectName
                    }
                },
                {
                    dataIndex: '__ruleText',
                    text:'Rules',
                    renderer: function(value,meta,record){                        
                        return value.join('\r\n');
                    }
                }
                
                ]
            });
        }
        
        var filename = 'timesheet-report.csv';

        this.logger.log('saving file:', filename);
        
        this.setLoading("Generating CSV");
        Deft.Chain.sequence([
            function() { return Rally.technicalservices.FileUtilities.getCSVFromRows(this,grid,rows); } 
        ]).then({
            scope: this,
            success: function(csv){
                this.logger.log('got back csv ', csv.length);
                if (csv && csv.length > 0){
                    Rally.technicalservices.FileUtilities.saveCSVToFile(csv,filename);
                } else {
                    Rally.ui.notify.Notifier.showWarning({message: 'No data to export'});
                }
                
            }
        }).always(function() { me.setLoading(false); });
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
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
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
    }
});
