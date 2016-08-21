/*
 * given a set of records, go get more information for them
 */
 
Ext.define('CA.techservices.DeepExporter',{
    config: {
        /*
         * An array of records
         */
        records: [],
        MilestonesByOID: {},
        TypeField: null,
        PlatformCapabilityField: null,
        /*
         * portfolioitem/Feature|portfolioitem/Initiative
         */
        BaseType: 'portfolioitem/Feature' 
    },
    
    constructor: function(config) {
        config = config || {};
        this.mergeConfig(config);
    },
    
    gatherDescendantInformation: function() {
        var me = this,
            records = this.records;
        // assume that the row represents a portfolio item of some sort
        
        var promises = Ext.Array.map(records, function(record){
            return [
                function() {
                    return me.getDependencyCounts(record,record.get('Item'));
                },
                function() {
                    return me.getDependencyCounts(record,record.get('Parent'));
                },
                function() {
                    return me.getDependencyCounts(record,record.get('Grandparent'));
                },
                function() {
                    return me.gatherDescendantsForPI(record);
                }
            ]
        });
        
        return Deft.Chain.sequence(Ext.Array.flatten(promises),this);
    },
    
    getDependencyCounts: function(record,item) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        
        if ( Ext.isEmpty(item) || Ext.isEmpty(item.Predecessors) || Ext.isEmpty(item.Predecessors.Count) ) {
            return [];
        }
        if ( Ext.isEmpty(item) || Ext.isEmpty(item.Successors) || Ext.isEmpty(item.Successors.Count) ) {
            return [];
        }
        
        if ( item.Successors.Count === 0 && item.Predecessors.Count === 0 ) {
            return [];
        }
        
        
        var oid = item.ObjectID;
        var model = item._type;
        
        Ext.create('Rally.data.wsapi.Store', {
            model: model,
            fetch: ['Predecessors','Successors'],
            pageSize: 1,
            filters: [{property:'ObjectID',value:oid}],
            context: { project: null },
            autoLoad: true,
            listeners: {
                load: function(store, records) {
                    records[0].getCollection('Predecessors').load({
                        fetch: [me.TypeField],
                        callback: function(predecessors) {
                            records[0].getCollection('Successors').load({
                                fetch: [me.TypeField],
                                callback: function(successors) {
                                    var total_count = successors.length + predecessors.length;
                                    var business_count = 0;
                                    Ext.Array.each( Ext.Array.flatten([successors,predecessors]), function(dep){
                                        if ( dep.get(me.TypeField) && dep.get(me.TypeField) == "Business" ) {
                                            business_count = business_count + 1;
                                        }
                                    });
                                    
                                    var platform_count = total_count - business_count;
                                    
                                    item.__PlatformDependencyCount = platform_count;
                                    item.__BusinessDependencyCount = business_count;
                                    
                                    deferred.resolve([]);
                                }
                                
                            });
                        }
                    });

                }
            }
        });
        
        return deferred.promise;
    },
    
    gatherDescendantsForPI: function(record) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        
        me.gatherStoriesForPI(record).then({
            success: function(stories) {
                record.set('_stories',stories);
                
                var rows = [ record.getData() ];
                Ext.Array.each(stories, function(story){
                    var row = Ext.clone(record.getData());
                    row.Story = story;
                    rows.push(row);
                });
                
                deferred.resolve(rows);
            },
            failure: function(msg){
                deferred.reject(msg);
            }
        });
        
        return deferred.promise;
    },
    
    gatherStoriesForPI: function(record) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        
        var filters = Rally.data.wsapi.Filter.or([
            {property:'Feature.ObjectID',value:record.get('ObjectID')},
            {property:'Feature.Parent.ObjectID',value:record.get('ObjectID')}
        ]);
        
        var config = {
            model:'HierarchicalRequirement',
            filters: filters,
            limit: Infinity,
            pageSize: 2000,
            fetch: ['ObjectID','FormattedID','Name','Description','c_AcceptanceCriteria',
                'Color','Project','Owner','Iteration','Release','Milestones','Expedite',
                'PlanEstimate','ScheduleState','Ready','TaskEstimateTotal','Defects','Feature',
                'State','PreliminaryEstimate','Ready','PercentDoneByStoryPlanEstimate', 
                'PercentDoneByStoryCount'
            ]
        };
        
        this._loadWsapiRecords(config).then({
            success: function(stories) {
                var promises = [];
                Ext.Array.each(stories, function(story){
                    promises.push(function() { return me._getTestCasesForStory(story.getData()); });
                });
                
                Deft.Chain.sequence(promises,this).then({
                    success: function(results) {
                        var stories = Ext.Array.flatten(results);
                        
                        if ( stories.length == 0 ) {
                            deferred.resolve(stories);
                            return;
                        }
                        
                        var promises = Ext.Array.map(stories, function(story){
                            return function() {
                                return me._setMilestonesOnStory(story); 
                            }
                        });
                        
                        Deft.Chain.sequence(promises,me).then({
                            success: function(stories_with_milestones) {
                                deferred.resolve(Ext.Array.flatten(stories_with_milestones));
                            },
                            failure: function(msg) {
                                deferred.reject(msg);
                            }
                        });
                        
                        
                    },
                    failure: function(msg) {
                        deferred.reject(msg);
                    }
                
                });
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        
        return deferred.promise;
    },
    
    _setMilestonesOnStory:function(story_data){
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        
        story_data._milestones = [];
        
        if ( Ext.isEmpty(story_data.Milestones) || story_data.Milestones.Count === 0 ) {
            return story_data;
        }
        
        var filters = Ext.Array.map(story_data.Milestones._tagsNameArray, function(ms){
            var oid = me._getOidFromRef(ms._ref);
            return { property:'ObjectID', value: oid };
        });
        
        if ( filters.length === 0 ) { return story_data; }
        
        var config = {
            model:'Milestone',
            filters: Rally.data.wsapi.Filter.or(filters),
            limit: Infinity,
            pageSize: 2000,
            fetch: ['ObjectID','Name','TargetDate']
        };
        
        this._loadWsapiRecords(config).then({
            success: function(milestones) {
                var ms_data = Ext.Array.map(milestones, function(milestone){ return milestone.getData(); });
                
                story_data._milestones = ms_data;
                deferred.resolve(story_data);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        return deferred.promise;
    },
    
    _getOidFromRef: function(ref) {
        var ref_array = ref.replace(/\.js$/,'').split(/\//);
        return ref_array[ref_array.length-1];
    },
    
    _getTestCasesForStory: function(story_data){
        var deferred = Ext.create('Deft.Deferred');
        
        var story_oid = story_data.ObjectID;
        var config = {
            model:'TestCase',
            filters: [{property:'WorkProduct.ObjectID',value:story_oid}],
            limit: Infinity,
            pageSize: 2000,
            fetch: ['ObjectID','FormattedID','Name','Type','LastVerdict']
        };
        
        this._loadWsapiRecords(config).then({
            success: function(testcases) {
                story_data._testcases = testcases;
                story_data._testcasecount_executed = 0;
                story_data._testcasecount_uat = 0;
                story_data._testcasecount_uat_executed = 0;
                Ext.Array.each(testcases, function(testcase){
                    var type = testcase.get('Type');
                    var verdict = testcase.get('LastVerdict');
                    if ( type == 'User Acceptance Testing' ) {
                        story_data._testcasecount_uat = story_data._testcasecount_uat + 1;
                    }
                    
                    if ( !Ext.isEmpty(verdict) ) {
                        story_data._testcasecount_executed = story_data._testcasecount_executed + 1 ;
                    }
                    
                    if (!Ext.isEmpty(verdict) && type == 'User Acceptance Testing' ) {
                        story_data._testcasecount_uat_executed = story_data._testcasecount_uat_executed + 1;
                    }
                });
                
                deferred.resolve(story_data);
                
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        
        return deferred.promise;
    },
     
    _loadWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        var default_config = {
            model: 'Defect',
            fetch: ['ObjectID'],
            compact: false
        };

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
    
    // given an array of hashes.  TODO: get columns from the app instead of here
    saveCSV: function(rows, file_name) {
        var me = this;
        
        var csv = Ext.Array.map(rows, function(row){
            return me.getCSVFromRow(row,me.getColumns());
        });
        
        csv.unshift(this.getHeadersFromColumns(this.getColumns()));
        
        csv = csv.join('\r\n');
        Rally.technicalservices.FileUtilities.saveCSVToFile(csv,file_name);
    },
    
    getCSVFromRow: function(row, columns) {
        if ( Ext.isEmpty(row) ){
            return;
        }
        
        var nodes = Ext.Array.map(columns, function(column){
            if ( Ext.isEmpty(column.fieldName) ) {
                return '';
            }
            
            
            var value = row[column.fieldName];
            
            if ( !Ext.isEmpty(column.renderer) ) {
                value = column.renderer(value,row);
            }
            
            if ( Ext.isEmpty(value) ) { return ""; }
            if ( Ext.isString(value) ) { return value.replace(/"/g,'""'); }
            
            return value
        });
        
        var csv_string = "";
        Ext.Array.each(nodes, function(node,idx){
            if ( idx > 0 ) {
                csv_string = csv_string + ",";
            }
            if (/^=/.test(node) ) {
                csv_string = csv_string + node;
            } else {
                csv_string = csv_string + '"' + node + '"';
            }

        });
        
        return csv_string;
    },
    
    getHeadersFromColumns: function(columns) {
        var nodes = Ext.Array.map(columns, function(column){
            return column.text;
        });
         
        var csv_string = "";
        Ext.Array.each(nodes, function(node,idx){
            if ( idx > 0 ) {
                csv_string = csv_string + ",";
            }
            if (/^=/.test(node) ) {
                csv_string = csv_string + node;
            } else {
                csv_string = csv_string + '"' + node + '"';
            }

        });
        
        return csv_string;
        
    },
    
    getColumns: function() {
        // NOT for models -- it's for a hash
        var columns = [];

        columns = Ext.Array.push(columns,this._getGrandparentColumns());
        columns = Ext.Array.push(columns,this._getParentColumns());
        columns = Ext.Array.push(columns,this._getItemColumns());
        columns = Ext.Array.push(columns,this._getStoryColumns());
        
        return columns;
    },
    
    _getStoryColumns: function() {
        return [
            {fieldName: 'Story', text: 'Story.FormattedID', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value.FormattedID;
            }},
            {fieldName: 'Story', text: 'Story.Name', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value.Name;
            }},
            {fieldName: 'Story', text: 'Story.ScheduleState', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.ScheduleState) ) { return ""; }
                
                return value.ScheduleState;
            }},
            {fieldName: 'Story', text: 'Story.Description', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Description) ) { return ""; }
                
                return value.Description;
            }},
            {fieldName: 'Story', text: 'Story.Ready', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Ready) ) { return "false"; }
                
                return value.Ready;
            }},
            {fieldName: 'Story', text: 'Story.Color', renderer: function(value,record){
                if (Ext.isEmpty(value) ) { return ""; }
                
                return value.DisplayColor;
            }},
            {fieldName: 'Story', text: 'Story.Project', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Project) ) { return ""; }
                return value.Project.Name;
            }},
            {fieldName: 'Story', text: 'Story.Owner', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Owner) ) { return ""; }
                return value.Owner._refObjectName;
            }},
            {fieldName: 'Story', text: 'Story.Iteration', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Iteration) ) { return ""; }
                return value.Iteration.Name;
            }},
            {fieldName: 'Story', text: 'Story.Release', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Release) ) { return ""; }
                return value.Release.Name;
            }},
            {fieldName: 'Story', text: 'Story.Expedite', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Expedite) ) { return "false"; }
                return value.Expedite;
            }},
            {fieldName: 'Story', text: 'Story.PlanEstimate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PlanEstimate) ) { return "false"; }
                return value.PlanEstimate;
            }},
            {fieldName: 'Story', text: 'Story.AcceptanceCriteria', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.c_AcceptanceCriteria) ) { return ""; }
                return value.c_AcceptanceCriteria;
            }},
            {fieldName: 'Story', text: 'Story.TaskEstimate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.TaskEstimateTotal) ) { return ""; }
                return value.TaskEstimateTotal;
            }},
            {fieldName: 'Story', text: 'Story.ExecutedTestCaseCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value._testcasecount_executed;
            }},
            {fieldName: 'Story', text: 'Story.UATTestCaseCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value._testcasecount_uat;
            }},
            {fieldName: 'Story', text: 'Story.ExecutedUATTestCaseCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value._testcasecount_uat_executed;
            }},
            {fieldName: 'Story', text: 'Story.Defects', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Defects) ) { return ""; }
                return value.Defects.Count;
            }},
            {fieldName: 'Story', text: 'Story.Milestones', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value._milestones) ) { return ""; }
                
                var display_array = Ext.Array.map(value._milestones, function(ms) {
                    var d = ms.TargetDate;
                    if ( !Ext.isEmpty(d) && ! Ext.isString(d) ) {
                        d = '- ' + Ext.Date.format(d, 'd-M-Y T');
                    }
                    return Ext.String.format("{0} {1}",
                        ms.Name,
                        d || ''
                    );
                });
                
                return display_array.join('| ');
            }}
            
                
        ];
    },
    
    _getItemColumns: function() {
        var me = this;
        var field = "Item";
        if (this.BaseType == "portfolioitem/Initiative") {
            field = "Feature";
        }
        
        return [
            {fieldName: field, text: 'Feature.FormattedID', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value.FormattedID;
            }},
            {fieldName: field, text: 'Feature.Name', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value.Name;
            }},
            {fieldName: field, text: 'Feature.State', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.State) ) { return ""; }
                
                return value.State.Name;
            }},
            {fieldName: field, text: 'Feature.Description', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Description) ) { return ""; }
                
                return value.Description;
            }},
            {fieldName: field, text: 'Feature.PreliminaryEstimate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PreliminaryEstimate) ) { return ""; }
                
                return value.PreliminaryEstimate.Name;
            }},
            {fieldName: field, text: 'Feature.Ready', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Ready) ) { return "false"; }
                
                return value.Ready;
            }},
            {fieldName: field, text: 'Feature.PercentDoneByStoryPlanEstimate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PercentDoneByStoryPlanEstimate) ) { return ""; }
                
                return Ext.String.format( "{0}%", value.PercentDoneByStoryPlanEstimate * 100 );
            }},
            {fieldName: field, text: 'Feature.PercentDoneByStoryCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PercentDoneByStoryCount) ) { return ""; }
                
                return Ext.String.format( "{0}%", value.PercentDoneByStoryCount * 100 );
            }},
            {fieldName: field, text: 'Feature.Color', renderer: function(value,record){
                if (Ext.isEmpty(value) ) { return ""; }
                
                return value.DisplayColor;
            }},
            {fieldName: field, text: 'Feature.Project', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Project) ) { return ""; }
                return value.Project.Name;
            }},
            {fieldName: field, text: 'Feature.Owner', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Owner) ) { return ""; }
                return value.Owner._refObjectName;
            }},
            {fieldName: field, text: 'Feature.InvestmentCategory', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.InvestmentCategory) ) { return ""; }
                return value.InvestmentCategory;
            }},
            {fieldName: field, text: 'Feature.ValueScore', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.ValueScore) ) { return ""; }
                return value.ValueScore;
            }},
            {fieldName: field, text: 'Feature.RiskScore', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.RiskScore) ) { return ""; }
                return value.RiskScore;
            }},
            {fieldName: field, text: 'Feature.WSJFScore', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.WSJFScore) ) { return ""; }
                return value.WSJFScore;
            }},
            {fieldName: field, text: 'Feature.RefinedEstimate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.RefinedEstimate) ) { return ""; }
                return value.RefinedEstimate;
            }},
            {fieldName: field, text: 'Feature.PlannedStartDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PlannedStartDate) ) { return ""; }
                return value.PlannedStartDate;
            }},
            {fieldName: field, text: 'Feature.PlannedEndDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PlannedEndDate) ) { return ""; }
                return value.PlannedEndDate;
            }},
            {fieldName: field, text: 'Feature.ActualStartDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.ActualStartDate) ) { return ""; }
                return value.ActualStartDate;
            }},
            {fieldName: field, text: 'Feature.ActualEndDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.ActualEndDate) ) { return ""; }
                return value.ActualEndDate;
            }},
            {fieldName: field, text: 'Feature.Release.Name', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Release) ) { return ""; }
                return value.Release.Name;
            }},
            {fieldName: field, text: 'Feature.Release.StartDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Release) ) { return ""; }
                return value.Release.ReleaseStartDate;
            }},
            {fieldName: field, text: 'Feature.Release.EndDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Release) ) { return ""; }
                return value.Release.ReleaseDate;
            }},
            {fieldName: field, text: 'Feature.Expedite', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Expedite) ) { return "false"; }
                return value.Expedite;
            }},
            {fieldName: field, text: 'Feature.CapabilityType', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value[me.TypeField]) ) { return ""; }
                return value[me.TypeField];
            }},
            {fieldName: field, text: 'Feature.PlatformCapability', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value[me.PlatformCapabilityField]) ) { return ""; }
                return value[me.PlatformCapabilityField];
            }},
            {fieldName: field, text: 'Feature.AcceptanceCriteria', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.c_AcceptanceCriteria) ) { return ""; }
                return value.c_AcceptanceCriteria;
            }},
            {fieldName: field, text: 'Feature.LeafStoryCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.LeafStoryCount) ) { return ""; }
                return value.LeafStoryCount;
            }},
            {fieldName: field, text: 'Feature.Milestones', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Milestones) || value.Milestones.Count === 0) { return ""; }
                
                return Ext.Array.map(value.Milestones._tagsNameArray, function(ms){
                    var oid = me._getOidFromRef(ms._ref);
                    var d = me.MilestonesByOID[oid] &&  me.MilestonesByOID[oid].get('TargetDate');
                                        
                    if ( !Ext.isEmpty(d) ) {
                        d = '- ' + Ext.Date.format(d, 'd-M-Y T');
                    }
                    return Ext.String.format("{0} {1}",
                        ms.Name,
                        d || ''
                    );
                }).join('| ');
            }},
            {fieldName: field, text: 'Feature.DependenciesCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PredecessorsAndSuccessors) ) { return ""; }
                
                return value.PredecessorsAndSuccessors.Count;
            }},
            {fieldName: field, text: 'Feature.Dependencies.Platform', renderer: function(value,record){
                if (Ext.isEmpty(value) || Ext.isEmpty(value.__PlatformDependencyCount) ) { return ""; }
                
                return value.__PlatformDependencyCount || 0;
            }},
            {fieldName: field, text: 'Feature.Dependencies.Business', renderer: function(value,record){
                if (Ext.isEmpty(value) || Ext.isEmpty(value.__PlatformDependencyCount) ) { return ""; }
                
                return value.__BusinessDependencyCount || 0;
            }}
        ];
    },
    
    _getParentColumns: function() {
        var me = this;
        var field = "Parent";
        if (this.BaseType == "portfolioitem/Initiative") {
            field = "Item";
        }
        
        return [
            {fieldName: field, text: 'Feature.Parent.FormattedID', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value.FormattedID;
            }},
            {fieldName: field, text: 'Feature.Parent.Name', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value.Name;
            }},
            {fieldName: field, text: 'Feature.Parent.State', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.State) ) { return ""; }
                
                return value.State.Name;
            }},
            {fieldName: field, text: 'Feature.Parent.Description', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Description) ) { return ""; }
                
                return value.Description;
            }},
            {fieldName: field, text: 'Feature.Parent.PreliminaryEstimate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PreliminaryEstimate) ) { return ""; }
                
                return value.PreliminaryEstimate.Name;
            }},
            {fieldName: field, text: 'Feature.Parent.Ready', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Ready) ) { return "false"; }
                
                return value.Ready;
            }},
            {fieldName: field, text: 'Feature.Parent.PercentDoneByStoryPlanEstimate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PercentDoneByStoryPlanEstimate) ) { return ""; }
                
                return Ext.String.format( "{0}%", value.PercentDoneByStoryPlanEstimate * 100 );
            }},
            {fieldName: field, text: 'Feature.Parent.PercentDoneByStoryCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PercentDoneByStoryCount) ) { return ""; }
                
                return Ext.String.format( "{0}%", value.PercentDoneByStoryCount * 100 );
            }},
            {fieldName: field, text: 'Feature.Parent.Color', renderer: function(value,record){
                if (Ext.isEmpty(value) ) { return ""; }
                
                return value.DisplayColor;
            }},
            {fieldName: field, text: 'Feature.Parent.Project', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Project) ) { return ""; }
                return value.Project.Name;
            }},
            {fieldName: field, text: 'Feature.Parent.Owner', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Owner) ) { return ""; }
                return value.Owner._refObjectName;
            }},
            {fieldName: field, text: 'Feature.Parent.InvestmentCategory', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.InvestmentCategory) ) { return ""; }
                return value.InvestmentCategory;
            }},
            {fieldName: field, text: 'Feature.Parent.ValueScore', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.ValueScore) ) { return ""; }
                return value.ValueScore;
            }},
            {fieldName: field, text: 'Feature.Parent.RiskScore', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.RiskScore) ) { return ""; }
                return value.RiskScore;
            }},
            {fieldName: field, text: 'Feature.Parent.WSJFScore', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.WSJFScore) ) { return ""; }
                return value.WSJFScore;
            }},
            {fieldName: field, text: 'Feature.Parent.RefinedEstimate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.RefinedEstimate) ) { return ""; }
                return value.RefinedEstimate;
            }},
            {fieldName: field, text: 'Feature.Parent.PlannedStartDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PlannedStartDate) ) { return ""; }
                return value.PlannedStartDate;
            }},
            {fieldName: field, text: 'Feature.Parent.PlannedEndDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PlannedEndDate) ) { return ""; }
                return value.PlannedEndDate;
            }},
            {fieldName: field, text: 'Feature.Parent.ActualStartDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.ActualStartDate) ) { return ""; }
                return value.ActualStartDate;
            }},
            {fieldName: field, text: 'Feature.Parent.ActualEndDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.ActualEndDate) ) { return ""; }
                return value.ActualEndDate;
            }},
            {fieldName: field, text: 'Feature.Parent.Expedite', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Expedite) ) { return "false"; }
                return value.Expedite;
            }},
            {fieldName: field, text: 'Feature.Parent.CapabilityType', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value[me.TypeField]) ) { return ""; }
                return value[me.TypeField];
            }},
            {fieldName: field, text: 'Feature.Parent.PlatformCapability', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value[me.PlatformCapabilityField]) ) { return ""; }
                return value[me.PlatformCapabilityField];
            }},
            {fieldName: field, text: 'Feature.Parent.AcceptanceCriteria', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.c_AcceptanceCriteria) ) { return ""; }
                return value.c_AcceptanceCriteria;
            }},
            {fieldName: field, text: 'Feature.Parent.LeafStoryCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.LeafStoryCount) ) { return ""; }
                return value.LeafStoryCount;
            }},
            {fieldName: field, text: 'Feature.Parent.Milestones', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Milestones) || value.Milestones.Count === 0) { return ""; }
                
                return Ext.Array.map(value.Milestones._tagsNameArray, function(ms){
                    var oid = me._getOidFromRef(ms._ref);
                    var d = me.MilestonesByOID[oid] &&  me.MilestonesByOID[oid].get('TargetDate');
                                        
                    if ( !Ext.isEmpty(d) ) {
                        d = '- ' + Ext.Date.format(d, 'd-M-Y T');
                    }
                    return Ext.String.format("{0} {1}",
                        ms.Name,
                        d || ''
                    );
                }).join('| ');
            }},
            {fieldName: field, text: 'Feature.Parent.DependenciesCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }

                var business = value.__BusinessDependencyCount || 0;
                var platform = value.__PlatformDependencyCount || 0;
                
                return platform + business;
            }},
            {fieldName: field, text: 'Feature.Parent.Dependencies.Platform', renderer: function(value,record){
                if (Ext.isEmpty(value) || Ext.isEmpty(value.__PlatformDependencyCount) ) { return ""; }
                
                return value.__PlatformDependencyCount || 0;
            }},
            {fieldName: field, text: 'Feature.Parent.Dependencies.Business', renderer: function(value,record){
                if (Ext.isEmpty(value) || Ext.isEmpty(value.__BusinessDependencyCount) ) { return ""; }
                
                return value.__BusinessDependencyCount || 0;
            }}
        ];
    },
    
    _getGrandparentColumns: function() {
        var me = this;
        
        var field = "Grandparent";
        if ( this.BaseType == "portfolioitem/Initiative") {
            field = "Parent";
        }
        return [
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.FormattedID', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value.FormattedID;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.Name', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value.Name;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.State', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.State) ) { return ""; }
                
                return value.State.Name;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.PreliminaryEstimate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PreliminaryEstimate) ) { return ""; }
                
                return value.PreliminaryEstimate.Name;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.Ready', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Ready) ) { return "false"; }
                
                return value.Ready;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.PercentDoneByStoryPlanEstimate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PercentDoneByStoryPlanEstimate) ) { return ""; }
                
                return Ext.String.format( "{0}%", value.PercentDoneByStoryPlanEstimate * 100 );
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.PercentDoneByStoryCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PercentDoneByStoryCount) ) { return ""; }
                
                return Ext.String.format( "{0}%", value.PercentDoneByStoryCount * 100 );
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.Color', renderer: function(value,record){
                if (Ext.isEmpty(value) ) { return ""; }
                
                return value.DisplayColor;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.Description', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }
                return value.Description;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.Project', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Project) ) { return ""; }
                return value.Project.Name;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.Owner', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Owner) ) { return ""; }
                return value.Owner._refObjectName;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.InvestmentCategory', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.InvestmentCategory) ) { return ""; }
                return value.InvestmentCategory;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.ValueScore', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.ValueScore) ) { return ""; }
                return value.ValueScore;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.RiskScore', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.RiskScore) ) { return ""; }
                return value.RiskScore;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.WSJFScore', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.WSJFScore) ) { return ""; }
                return value.WSJFScore;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.RefinedEstimate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.RefinedEstimate) ) { return ""; }
                return value.RefinedEstimate;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.PlannedStartDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PlannedStartDate) ) { return ""; }
                return value.PlannedStartDate;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.PlannedEndDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.PlannedEndDate) ) { return ""; }
                return value.PlannedEndDate;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.ActualStartDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.ActualStartDate) ) { return ""; }
                return value.ActualStartDate;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.ActualEndDate', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.ActualEndDate) ) { return ""; }
                return value.ActualEndDate;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.Expedite', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Expedite) ) { return "false"; }
                return value.Expedite;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.CapabilityType', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value[me.TypeField]) ) { return ""; }
                return value[me.TypeField];
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.PlatformCapability', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value[me.PlatformCapabilityField]) ) { return ""; }
                return value[me.PlatformCapabilityField];
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.LeafStoryCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.LeafStoryCount) ) { return ""; }
                return value.LeafStoryCount;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.Milestones', renderer: function(value,record){                
                if (Ext.isEmpty(value) || Ext.isEmpty(value.Milestones) || value.Milestones.Count === 0) { return ""; }
                
                return Ext.Array.map(value.Milestones._tagsNameArray, function(ms){
                    var oid = me._getOidFromRef(ms._ref);
                    var d = me.MilestonesByOID[oid] &&  me.MilestonesByOID[oid].get('TargetDate');
                                        
                    if ( !Ext.isEmpty(d) ) {
                        d = '- ' + Ext.Date.format(d, 'd-M-Y T');
                    }
                    return Ext.String.format("{0} {1}",
                        ms.Name,
                        d || ''
                    );
                }).join('| ');
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.DependenciesCount', renderer: function(value,record){                
                if (Ext.isEmpty(value) ) { return ""; }

                var business = value.__BusinessDependencyCount || 0;
                var platform = value.__PlatformDependencyCount || 0;
                
                return platform + business;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.Dependencies.Platform', renderer: function(value,record){
                if (Ext.isEmpty(value) || Ext.isEmpty(value.__PlatformDependencyCount) ) { return ""; }
                
                return value.__PlatformDependencyCount || 0;
            }},
            {fieldName: field, text: 'Feature.Parent.PortfolioItem.Dependencies.Business', renderer: function(value,record){
                if (Ext.isEmpty(value) || Ext.isEmpty(value.__BusinessDependencyCount) ) { return ""; }
                
                return value.__BusinessDependencyCount || 0;
            }}
        ];
    }
    
    
});