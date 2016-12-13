(function () {
    var Ext = window.Ext4 || window.Ext;

    Ext.define("CA.techservices.picker.PortfolioItemPicker", {
        extend: "Ext.container.Container",
        alias: "widget.portfolioitempickerbutton",

        requires: [
            'Deft.Deferred',
            'Rally.util.Test',
            'Rally.ui.EmptyTextFactory',
            'Rally.ui.dialog.ChooserDialog',
            'Rally.data.wsapi.Store'
        ],

        emptyText: '<p>No portfolio items match your search criteria.</p>',

        items: [
            {
                xtype: "container",
                name: "portfolioItemPicker",
                layout: {
                    type: "hbox"
                },
                items: [
                    {

                        xtype: 'rallybutton',
                        text: 'Step 1: Choose Business Initiative / Capability',
                        itemId: 'portfolioItemButton',
                        cls: 'piButton primary small'
                    },
                    {
                        xtype: 'container',
                        items: [
                            {
                                xtype: 'container',
                                itemId: 'portfolioItemDisplay',
                                value: "&nbsp;"
                            }
                        ]
                    }

                ]
            }
        ],

        initComponent: function () {
            this.callParent(arguments);
        },
        
        beforeRender: function () {
            this._configureButton();
            this._configurePicker();
        },

        _configureButton: function () {
            this.down('#portfolioItemButton').on('click', this._onButtonClick, this);
        },

        _configurePicker: function () {
            //this._setValueFromSettings();
            this._loadPortfolioItems();
        },

        _setValueFromSettings: function () {
            var newSettingsValue = this.settingsParent.app.getSetting("portfolioItemPicker"),
                oldSettingsValue = this.settingsParent.app.getSetting("buttonchooser");

            if (this._isSettingValid(newSettingsValue)) {
                this.setValue(newSettingsValue);
            } else if (this._isSettingValid(oldSettingsValue)) {
                this.setValue(Ext.JSON.decode(oldSettingsValue).artifact._ref);
            } else {
                this.setValue("&nbsp;");
            }
        },

        _isSettingValid: function (value) {
            return value && value !== "undefined";
        },

        _loadPortfolioItems: function () {
            if (this._isSavedValueValid()) {
                this._createPortfolioItemStore();
            }
        },

        _createPortfolioItemStore: function () {
            if ( Ext.isEmpty(this.value) || this.value.length === 0 ) {
                return;
            }
            var filters = Rally.data.wsapi.Filter.or(
                Ext.Array.map(this.value,function(pi_ref){
                    return {
                        property: "ObjectID",
                        operator: "=",
                        value: Rally.util.Ref.getOidFromRef(pi_ref)
                    };
                })
            );
            
            Ext.create("Rally.data.wsapi.Store", {
                model: Ext.identityFn("Portfolio Item"),
                filters: filters,
                context: this.requestContext,
                autoLoad: true,
                listeners: {
                    load: this._onPortfolioItemsRetrieved,
                    scope: this
                }
            });
        },

        _isSavedValueValid: function () {
            return Ext.isArray(this.value) && this.value !== "undefined";
        },

        _onPortfolioItemsRetrieved: function (store,records) {
            this._handleStoreResults(records);
        },

        _setDisplayValue: function () {
            var container = this.down('#portfolioItemDisplay');
            container.removeAll();
            container.add(this._getPortfolioItemDisplay());
        },

        _onButtonClick: function () {
            this._destroyChooser();

            this.dialog = Ext.create("CA.techservices.dialog.TypedArtifactChooserDialog", this._getChooserConfig());
            this.dialog.show();
        },

        _destroyChooser: function () {
            if (this.dialog) {
                this.dialog.destroy();
            }
        },

        _getPortfolioItemDisplay: function () {
            if ( Ext.isEmpty(this.portfolioItems) ) {
                this.portfolioItems = [];
                return;
            }
            if ( ! Ext.isArray(this.portfolioItems) ) {
                this.portfolioItems = [this.portfolioItems];
            }
            
            return Ext.Array.map(this.portfolioItems, function(pi){
                //var text = Ext.String.format("{0}: {1} <span class='icon-delete'></span>", pi.FormattedID, pi.Name);
                var text = Ext.String.format("{0}: {1}", pi.FormattedID, pi.Name);
                return {
                    xtype:'button',
                    
//                    cls: 'pi-delete-button',
                    cls: 'pi-button',
                    text: text
//                    listeners: {
//                        scope: this, 
//                        click: function() {
//                            this._removeItem(pi);
//                        }
//                    }
                };
            },this);
        },

        _removeItem: function(record) {
            this.portfolioItems = Ext.Array.filter(this.portfolioItems, function(pi){
                return ( record.FormattedID != pi.FormattedID );
            });
            
            this.portfolioItemRefs = Ext.Array.map(this.portfolioItems, function(pi) { return pi._ref; });
            this.setValue(this.portfolioItemRefs);

            this._setDisplayValue();
        },
        
        _onPortfolioItemChosen: function (dialog,foundItems) {
            var found_array = foundItems;
            if ( !Ext.isArray(foundItems) ) { found_array = [foundItems]; }
            var existing_items = this.portfolioItems || [];
            
            //var all_items = Ext.Array.merge(found_array, existing_items);
            var all_items = found_array;
            
            this._handleStoreResults(all_items);
            this.fireEvent('itemschosen',this,all_items);
            this._destroyChooser();
        },
        
        _filterUniquePIs: function(items) {
            var hash = {};
            Ext.Array.each(items, function(item) {
                var ref = item._ref || item.get('_ref');
                hash[ref] = item;
            });
            
            return Ext.Object.getValues(hash);
        },

        _handleStoreResults: function(store) {
            if (store) {
                if ( Ext.isArray(store) ) {
                    var pis = Ext.Array.map(store, function(pi) { 
                        if ( !Ext.isEmpty(pi) && Ext.isFunction(pi.getData) ) {
                            return pi.getData();
                        }
                        return pi;
                    });
                    
                    this.portfolioItems = this._filterUniquePIs(pis);
                    
                    this.portfolioItemRefs = Ext.Array.map(this.portfolioItems, function(pi) {
                        return pi._ref;
                    });
                    
                    this._setDisplayValue();
                    this.setValue(this.portfolioItemRefs);
                } else if (store.data) {
                    this.portfolioItem = store.data;
                    this._setDisplayValue();
                    this.setValue(this.portfolioItem._ref);
                }
            }
        },

        _getChooserConfig: function () {
            return {
                artifactTypes: ['portfolioitem/capability','portfolioitem/initiative'],
                multiple: false,
                height: 350,
                title: 'Choose Portfolio Item to Add',
                closeAction: 'destroy',
                selectionButtonText: 'Select',
                _isArtifactEditable: function(record) {
                    return true;
                },
                listeners: {
                    artifactChosen: this._onPortfolioItemChosen,
                    scope: this
                },
                storeConfig: {
                    project: null,
                    context: this.requestContext,
                    fetch: ['ObjectID','Project','WorkSpace','FormattedID','Name','ActualStartDate','PlannedStartDate','ActualEndDate','PlannedEndDate']
                },
                gridConfig: {
                    viewConfig: {
                        emptyText: Rally.ui.EmptyTextFactory.getEmptyTextFor(this.emptyText),
                        getRowClass: function(record) {
                            return Rally.util.Test.toBrowserTestCssClass('row', record.getId()) + '';
                        }
                    }
                }
            };
        },

        setValue: function (value) {
            
            if (value && value !== "undefined") {
                if ( Ext.isString(value) ) {
                    value = value.split(',');
                }
                this.value = value;
            }
            else {
                this.value = this.settingsParent.app.getSetting("portfolioItemPicker");
            }
        },

        getSubmitData: function () {
            var returnObject = {};

            if ( this.portfolioItemRefs && Ext.isArray(this.portfolioItemRefs) ) {
                this.setValue(this.portfolioItemRefs);
                returnObject.portfolioItemPicker = this.portfolioItemRefs;                
            } else if (this.portfolioItem) {

                this.setValue(this.portfolioItem._ref);
                returnObject.portfolioItemPicker = this.portfolioItem._ref;
            }
            else {
                returnObject.portfolioItemPicker = "";
            }

            return returnObject;
        }
    });
}());