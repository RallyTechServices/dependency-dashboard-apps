Ext.define('CA.techservices.dialog.TypedArtifactChooserDialog', {
    extend: 'Rally.ui.dialog.ArtifactChooserDialog',
    alias: 'widget.tstypedartifactchooserdialog',

    getGridModels: function() {
        return this.chosenTypes || this.artifactTypes;
    },
    
    getSearchBarItems: function() {
        var me = this,
            items = [],
            types = this.artifactTypes;
            
        this.chosenTypes = [ this.artifactTypes[0] ];
        
        if ( !Ext.isEmpty(types) && types.length > 1 ) {
            var store = Ext.create('Rally.data.custom.Store',{
                xtype:'rallycustom',
                autoLoad: true,
                data: Ext.Array.map(types, function(type) {
                    var type_name = type.replace(/.*\//,'');
                    
                    return {_refObjectName:type_name, _ref:type};
                })
            });
            
            items.push({
                xtype:'rallycombobox',
                store: store,
                listeners: {
                    select: function(cb) {
                        me.chosenTypes = [ cb.getValue() ];
                        me.selectionCache = [];
                        me._enableDoneButton();
                        me.buildGrid();
                    }
                }
            });
        }
        
        items.push({
            xtype: 'triggerfield',
            cls: 'rui-triggerfield chooser-search-terms',
            emptyText: 'Search Keyword or ID',
            enableKeyEvents: true,
            flex: 1,
            itemId: 'searchTerms',
            listeners: {
                keyup: function (textField, event) {
                    if (event.getKey() === Ext.EventObject.ENTER) {
                        this._search();
                    }
                },
                afterrender: function (field) {
                    field.focus();
                },
                scope: this
            },
            triggerBaseCls: 'icon-search chooser-search-icon'
        });
        
        return items;
    }
});