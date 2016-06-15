
Ext.define('CA.techservices.timesheet.TimeRow',{
    extend: 'Ext.data.Model',
    
    fields: [
        { name: 'ObjectID', type:'integer' },
        { name: 'Theme', type:'object' },
        { name: 'Initiative', type: 'object' },
        { name: 'FormattedID', type: 'string' },
        { name: 'Name', type:'string' },
        { name: 'State', type:'object' },
        { name: 'Project', type:'object' },
        { name: 'Owner', type:'object' },
        { name: 'Milestones', type:'object' },
        { name: 'PlannedEndDate', type: 'object' },
        { name: 'PlannedStartDate', type: 'object' },
        { name: 'LeafStoryCount', type:'integer' },
        { name: 'LeafStoryPlanEstimateTotal', type: 'float' },
        { name: 'PercentDoneByStoryCount', type: 'float' },
        { name: 'PercentDoneByStoryPlanEstimate', type: 'float' },
        { name: '__RelatedRecords', type:'auto'},
        { name: 'Release', type:'object' },
        { name: 'BusinessFeature', type: 'object', convert: 
            function(value,record) {
                if ( !Ext.isEmpty(value) ) { return value; }
                return record.get('Feature');
            }
        },
        
        { name: '_type', type: 'string' },
        { name: '_ref', type: 'string' },
        
        { name: '_Level', type: 'integer', defaultValue: 0 },
        
        { name: '__Type', type: 'string', defaultValue: null, convert: 
            function(value,record) {
                if ( !Ext.isEmpty(value) ) { return value; }
                
                var level = record.get('_Level');
                
                if ( level === 0 ) { return "Business"; }
                return "Platform";
            }
        },
        
        { name: '__ThemeFID', type: 'string', defaultValue: null, convert: 
            function(value,record) {
                if ( !Ext.isEmpty(value) ) { return value; }
                
                var item = record.get('Theme');
                
                if ( Ext.isEmpty(item) ) { return null; }
                return item.FormattedID;
            }
        },
        
        { name: '__ThemeName', type: 'string', defaultValue: null, convert: 
            function(value,record) {
                if ( !Ext.isEmpty(value) ) { return value; }
                
                var item = record.get('Theme');
                
                if ( Ext.isEmpty(item) ) { return null; }
                return item.Name || null
            }
        },
        
        { name: '__InitiativeFID', type: 'string', defaultValue: null, convert: 
            function(value,record) {
                if ( !Ext.isEmpty(value) ) { return value; }
                
                var item = record.get('Initiative');
                
                if ( Ext.isEmpty(item) ) { return null; }
                return item.FormattedID || null;
            }
        },
        
        { name: '__InitiativeName', type: 'string', defaultValue: null, convert: 
            function(value,record) {
                if ( !Ext.isEmpty(value) ) { return value; }
                
                var item = record.get('Initiative');
                
                if ( Ext.isEmpty(item) ) { return null; }
                return item.Name || null;
            }
        },
        
        { name: '__FeatureFID', type: 'string', defaultValue: null, convert: 
            function(value,record) {
                if ( !Ext.isEmpty(value) ) { return value; }
                
                var item = record.get('Feature');
                
                if ( Ext.isEmpty(item) ) { return null; }
                return item.FormattedID || null;
            }
        },
        
        { name: '__FeatureName', type: 'string', defaultValue: null, convert: 
            function(value,record) {
                if ( !Ext.isEmpty(value) ) { return value; }
                
                var item = record.get('Feature');
                
                if ( Ext.isEmpty(item) ) { return null; }
                return item.Name || null;
            }
        },
        
        { name: '__BusinessFeatureFID', type: 'string', defaultValue: null, convert: 
            function(value,record) {
                if ( !Ext.isEmpty(value) ) { return value; }
                
                var item = record.get('BusinessFeature');
                
                if ( Ext.isEmpty(item) ) { return null; }
                return item.FormattedID || null;
            }
        },
        
        { name: '__BusinessFeatureName', type: 'string', defaultValue: null, convert: 
            function(value,record) {
                if ( !Ext.isEmpty(value) ) { return value; }
                
                var item = record.get('BusinessFeature');
                
                if ( Ext.isEmpty(item) ) { return null; }
                return item.Name || null;
            }
        },
        
        { name: '__LeafStoryCount', type:'integer', convert: function(value,record) {
            if ( !Ext.isEmpty(value) ) { return value; }
            return record.get('LeafStoryCount') || 0;
        }},
        { name: '__LeafStoryPlanEstimateTotal', type: 'float', convert: function(value,record) {
            if ( !Ext.isEmpty(value) ) { return value; }
            return record.get('LeafStoryPlanEstimateTotal') || 0;
        } },
        { name: '__PercentDoneByStoryCount', type: 'float', convert: function(value,record) {
            if ( !Ext.isEmpty(value) ) { return value; }
            return record.get('PercentDoneByStoryCount') || 0;
        } },
        { name: '__PercentDoneByStoryPlanEstimate', type: 'float', convert: function(value,record) {
            if ( !Ext.isEmpty(value) ) { return value; }
            return record.get('PercentDoneByStoryPlanEstimate') || 0;
        } }
    ],
    
    addRelatedRecord: function( record ) {
        var records = this.get('__RelatedRecords') || [];
        var new_record_oid = record.get('ObjectID');
        var ok_to_add = true;
        Ext.Array.each(records, function(record){
            if ( record.get('ObjectID') == new_record_oid ) {
                ok_to_add = false;
            }
        });
        
        if ( ok_to_add ) {
            records.push(record);
        }
//        
//        console.log(this.get('FormattedID'), record.get('FormattedID'), 'related records: ', records, this.get('__RelatedRecords'));
//        
          this.set('__RelatedRecords', records);
//        
        this.set('__LeafStoryCount',0);
        
        var my_count = this.get('LeafStoryCount');
        var my_count_ratio = this.get('PercentDoneByStoryCount');
        var my_size = this.get('LeafStoryPlanEstimateTotal');
        var my_size_ratio = this.get('PercentDoneByStoryPlanEstimate');
        
        var counts = Ext.Array.map(records, function(record){ return record.get('LeafStoryCount') || 0 });
        this.set('__LeafStoryCount', Ext.Array.sum(counts) + my_count);
        
        var sizes = Ext.Array.map(records, function(record){ return record.get('LeafStoryPlanEstimateTotal') || 0 });
        this.set('__LeafStoryPlanEstimateTotal', Ext.Array.sum(sizes) + my_size );
        
        var accepted_counts = Ext.Array.map(records, function(record){
            var count = record.get('LeafStoryCount') || 0;
            var ratio = record.get('PercentDoneByStoryCount') || 0;
            
            return count * ratio;
        });
        var my_accepted_count = my_count * my_count_ratio;
        
        var count_ratio = 0;
        if ( this.get('__LeafStoryCount') > 0 ) {
            count_ratio = ( Ext.Array.sum(accepted_counts) + my_accepted_count ) / this.get('__LeafStoryCount');
        }
        
        this.set('__PercentDoneByStoryCount', count_ratio);
        
        var accepted_sizes = Ext.Array.map(records, function(record){
            var count = record.get('LeafStoryPlanEstimateTotal') || 0;
            var ratio = record.get('PercentDoneByStoryPlanEstimate') || 0;
            
            return count * ratio;
        });
        var my_accepted_size = my_size * my_size_ratio;
        
        var size_ratio = 0;
        if ( this.get('__LeafStoryPlanEstimateTotal') > 0 ) {
            size_ratio = ( Ext.Array.sum(accepted_sizes) + my_accepted_size ) / this.get('__LeafStoryPlanEstimateTotal');
        }
        
        this.set('__PercentDoneByStoryPlanEstimate', size_ratio);
    }
});
