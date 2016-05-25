Ext.define("TSDependencyStatusReport", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    items: [
        {xtype:'container',itemId:'selector_box'},
        {xtype:'container',itemId:'display_box'}
    ],

    integrationHeaders : {
        name : "TSDependencyStatusReport"
    },
                        
    launch: function() {
        var me = this;
        this._addPortfolioItemSelector(this.down('#selector_box'));
    },
      
    _addPortfolioItemSelector: function(container) {
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
                }
            }
        });
    },
    
    _updateData: function() {
        this.logger.log("_updateData", this.PIs);
        
        Deft.Chain.pipeline([
            this._getChildFeatures,
            this._getRelatedFeatures
        ],this);
    },
    
    _getChildFeatures: function() {
        this.setLoading('Fetching descendant features...');
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
        
        var filter_configs = Ext.Array.map(this.PIs, function(pi) {
            return [
                {property:'Parent.ObjectID',value:pi.get('ObjectID')},
                {property:'Parent.Parent.ObjectID',value:pi.get('ObjectID')}
            ];
        });
        
        var filters = Rally.data.wsapi.Filter.or(Ext.Array.flatten(filter_configs));
        var config = {
            model: 'PortfolioItem/Feature',
            filters: filters,
            fetch: ['ObjectID','FormattedID','Name','Predecessors','Successors']
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
        
        this.baseFeaturesByOID = {};
        var promises = [];
        
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
    
    _getPredecessors: function(feature) {
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
            
        this.logger.log('Finding predecessors for', feature.get('FormattedID'));
        if ( feature.get('Predecessors').Count === 0 ) {
            feature.set('_predecessors', []);
            return [];
        }
        
        feature.getCollection('Predecessors').load({
            fetch: ['FormattedID', 'ObjectID', 'Name'],
            scope: this,
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
            fetch: ['FormattedID', 'ObjectID', 'Name'],
            scope: this,
            callback: function(records, operation, success) {
                feature.set('_successors', records);
                deferred.resolve(records);
            }
        });
        
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
    
    _displayGrid: function(store,field_names){
        this.down('#display_box').add({
            xtype: 'rallygrid',
            store: store,
            columnCfgs: field_names
        });
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
    
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        // Ext.apply(this, settings);
        this.launch();
    }
});
