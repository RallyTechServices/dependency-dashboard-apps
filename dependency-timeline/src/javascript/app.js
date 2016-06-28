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
    
    _updateData: function() {
        var release = null;
        this.rows = [];
        this.base_features = [];
        this.baseFeaturesByOID = {};
        
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
            
        //this.logger.log('Finding predecessors for', feature.get('FormattedID'));
        if ( feature.get('Predecessors').Count === 0 ) {
            feature.set('_predecessors', []);
            return [];
        }
        
        feature.getCollection('Predecessors').load({
            fetch: ['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate','Milestones','State',
                'TargetDate','PlannedEndDate','PlannedStartDate','Project','Owner','Release'],
            scope: this,
            filters: [Ext.create('Rally.data.wsapi.Filter',{property:this.type_field, operator:'!=', value:'Business'})],
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
            
        //this.logger.log('Finding successors for', feature.get('FormattedID'));
        if ( feature.get('Successors').Count === 0 ) {
            feature.set('_successors', []);
            return [];
        }
        
        feature.getCollection('Successors').load({
            fetch: ['ObjectID','FormattedID','Name','Parent','Predecessors','Successors',
                'PercentDoneByStoryCount','PercentDoneByStoryPlanEstimate','Milestones','State',
                'TargetDate','PlannedEndDate','PlannedStartDate','Project','Owner','Release'], 
            scope: this,
            filters: [Ext.create('Rally.data.wsapi.Filter',{property:this.type_field, operator:'!=', value:'Business'})],
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
        
        var release = this.down('rallyreleasecombobox') && this.down('rallyreleasecombobox').getRecord();
        if ( !Ext.isEmpty(release) && release.get('Name') != this.clearText ) {
            rows.push(Ext.create('CA.techservices.timesheet.TimeRow',Ext.Object.merge({
                    _Level: 0
                },
                release.getData()
            )));
        }
        
        Ext.Array.each(this.PIs, function(chosen_pi){
            var row = Ext.create('CA.techservices.timesheet.TimeRow', Ext.Object.merge({
                    _Level: 1,
                    Theme: null,
                    Initiative: null,
                    BusinessFeature: null
                }, chosen_pi.getData() )
            );
            
            rows.push(row);
        });
        
        Ext.Object.each(base_features_by_oid, function(oid,feature){
           var initiative_oid = feature.get('Parent') && feature.get('Parent').ObjectID;
            var theme = null;

            if ( !Ext.isEmpty(initiative_oid) && !Ext.isEmpty(me.parentsByOID[initiative_oid]) && !Ext.isEmpty(me.parentsByOID[initiative_oid].Parent)) {
                theme = me.parentsByOID[initiative_oid].Parent;
            }
            var business_feature = Ext.create('CA.techservices.timesheet.TimeRow', Ext.Object.merge({
                    _Level: 2,
                    Theme: theme,
                    Initiative: feature.get('Parent'),
                    BusinessFeature: feature.getData()
                }, feature.getData() )
            );
            
            rows.push(business_feature);
            
            Ext.Array.each(feature.get('_predecessors'), function(dependency){
                console.log(dependency);
                
                var initiative_oid = dependency.get('Parent') && dependency.get('Parent').ObjectID;
                
                theme = null;

                if ( !Ext.isEmpty(initiative_oid) && !Ext.isEmpty(me.parentsByOID[initiative_oid]) && !Ext.isEmpty(me.parentsByOID[initiative_oid].Parent)) {
                    theme = me.parentsByOID[initiative_oid].Parent;
                }
//              
                var related_record = Ext.create('CA.techservices.timesheet.TimeRow', Ext.Object.merge({
                        _Level: 3,
                        Theme: theme,
                        Initiative: feature.get('Parent'),
                        BusinessFeature: feature.getData()
                    }, dependency.getData() )
                );
                
                business_feature.addRelatedRecord(related_record);
                rows.push(related_record);
            });
////            
            Ext.Array.each(feature.get('_successors'), function(dependency){
                console.log(dependency);
                var initiative_oid = dependency.get('Parent') && dependency.get('Parent').ObjectID;
                theme = null;

                if ( !Ext.isEmpty(initiative_oid) && !Ext.isEmpty(me.parentsByOID[initiative_oid]) && !Ext.isEmpty(me.parentsByOID[initiative_oid].Parent)) {
                    theme = me.parentsByOID[initiative_oid].Parent;
                }
                
                me.logger.log( 'related', feature.get('FormattedID'), dependency.get('FormattedID') );
                
                var related_record = Ext.create('CA.techservices.timesheet.TimeRow', Ext.Object.merge({
                        _Level: 3,
                        Theme: theme,
                        Initiative: feature.get('Parent'),
                        BusinessFeature: feature.getData()
                    }, dependency.getData() )
                );
                
                business_feature.addRelatedRecord(related_record);
                rows.push(related_record);
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
    
    // override to make labels differently
    getCategoryString: function(record) {
        var record_type = record.get('_type');
        var level = record.get('_Level');
        
        var string = Ext.String.format( '{0}: {1}',
            record.get('FormattedID'),
            record.get('Name')
        );
        
       
        if ( level == 2 ) {
            string = "<span style='background-color:#e7f5fe;'>" + string + "</span>";
        }
        if ( record_type == 'iteration' || record_type == 'release' ) {
            string = record.get('Name');
        }
        var level = record.get('_Level') || 0;
        var prefix = Ext.String.repeat('&nbsp;&nbsp&nbsp;', level);
        
        return prefix + string;
    },
    
    _getChartConfig: function(rows) {
        var me = this;
        var config = {
            xtype: 'tsalternativetimeline',
            height: 500,
            width: this.getWidth() - 20,
            records: rows,
            pageSize: 7,
            getCategoryString: me.getCategoryString
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
        Ext.Array.each(this.PIs, function(pi){
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
        Ext.Array.each(this.PIs, function(pi){
            if ( Ext.isEmpty(pi.get('PlannedEndDate')) ) { return; }
            if ( Ext.isEmpty(latest_pi_end) ) { latest_pi_end = pi.get('PlannedStartDate'); }
            if ( latest_pi_end < pi.get('PlannedEndDate') ) { latest_pi_end = pi.get('PlannedEndDate'); }
            
        });
        
        var end = null;
        if ( !Ext.isEmpty(latest_pi_end) ) { end = latest_pi_end; }
        
        var release = this.down('rallyreleasecombobox') && this.down('rallyreleasecombobox').getRecord();
        if ( !Ext.isEmpty(release) && !Ext.isEmpty(release.get('ReleaseDate')) ) {
            release_end = release.get('ReleaseStartDate');
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
