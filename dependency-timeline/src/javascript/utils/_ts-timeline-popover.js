Ext.define('CA.techservices.popover.TimelinePopover',{
    extend: 'Rally.ui.popover.PercentDonePopover',
    
    config: {
        typeField: "Name"
    },

    _setTitle: function() {
        this.setTitle(Ext.String.format("{0} ({1})",
            this.config.percentDoneData.FormattedID,
            Rally.util.HealthColorCalculator.calculateHealthColorForPortfolioItemData(this.config.percentDoneData, this.getPercentDoneName()).label)
        );
    },
    
    
    getAcceptedTpl: function() {
        return Ext.create('Ext.XTemplate',
            '<h3>% DONE</h3>',
            '<div class="percentDoneLine">',
                '{[this.renderPercentDoneByStoryPlanEstimate(values)]}',
                '<div class="percentDoneText">{AcceptedLeafStoryPlanEstimateTotal} of {LeafStoryPlanEstimateTotal} Points Accepted</div>',
            '</div>',
            '<div class="percentDoneLine">',
                '{[this.renderPercentDoneByStoryCount(values)]}',
                '<div class="percentDoneText">{AcceptedLeafStoryCount} of {LeafStoryCount} User Stories Accepted</div>',
            '</div>',
            '<tpl if="UnEstimatedLeafStoryCount &gt; 0">',
                '<div class="dangerNotification percentDoneLine">',
                    'Missing Estimates: ',
                    '<div><b>{UnEstimatedLeafStoryCount} User Stor{[values.UnEstimatedLeafStoryCount == 1? "y" : "ies"]}</b></div>',
                '</div>',
            '</tpl>',
            '<tpl if="!PlannedEndDate && !ActualEndDate">',
                '<div class="dangerNotification percentDoneLine">Item is Missing Planned End Date</div>',
            '</tpl>', {
            renderPercentDoneByStoryPlanEstimate: function(recordData) {
                return Ext.create('Rally.ui.renderer.template.progressbar.PortfolioItemPercentDoneTemplate', {
                    percentDoneName: 'PercentDoneByStoryPlanEstimate',
                    height: '15px',
                    width: '50px',
                    isClickable: false
                }).apply(recordData);
            },
            renderPercentDoneByStoryCount: function(recordData) {
                return Ext.create('Rally.ui.renderer.template.progressbar.PortfolioItemPercentDoneTemplate', {
                    percentDoneName: 'PercentDoneByStoryCount',
                    height: '15px',
                    width: '50px',
                    isClickable: false
                }).apply(recordData);
            }
        });
    },
        
    _buildContent: function(percentDoneData) {
        var html = '';
        percentDoneData.instance = this;
        percentDoneData.canUpdate = this.config.canUpdate;

        html += '<div class="percentDoneContainer">';

        html += this.getAcceptedTpl().apply(percentDoneData);

        if (!Ext.isEmpty(percentDoneData.ActualEndDate)) {
            html += this.getActualEndDateTpl().apply(percentDoneData);
        }

        if(this._shouldShowReleaseSection(percentDoneData)) {
            html += this.getReleaseTpl().apply(percentDoneData);

            if(this._shouldShowLateChildAlert(percentDoneData)) {
                html += this.getLateChildTpl().apply(percentDoneData);
            }
        }

        if (this._shouldShowNotes(percentDoneData)) {
            html += this.getNotesTpl().apply(percentDoneData);
        }
        
        html += this.getItemSummaryTpl().apply(percentDoneData);

        html += '</div>';

        return html;
    },
    
    // TODO:  team, owner, release, type, business feature?

    getItemSummaryTpl: function() {
        return Ext.create('Ext.XTemplate',
            '<hr/>',
            '<table>',
            '<tpl>',
            '{[this.getTypeMessage(values)]}',
            '{[this.getGrandparentMessage(values)]}',
            '{[this.getParentMessage(values)]}',
            '{[this.getStateMessage(values)]}',
            '{[this.getOwnerMessage(values)]}',
            '{[this.getReleaseMessage(values)]}',
            '{[this.getMilestoneMessage(values)]}',
            
            '</tpl>',
            '</table>', {
            getTypeMessage: _.bind(function(values){
                var type = "Platform";
                
                console.log(values);
                if ( values._Level == 2 || values.__Type == "Business" ) {
                    type = "Business";
                }
                return Ext.String.format('<tr><td>Type</td><td>{0}</td></tr>', type);
            },this),    
            getOwnerMessage: _.bind(function(values){
                if (Ext.isEmpty(values.Owner)) {
                    return "";
                }
                return Ext.String.format('<tr><td>Owner</td><td>{0}</td></tr>', values.Owner._refObjectName);
            },this),    
            getReleaseMessage: _.bind(function(values){
                if (Ext.isEmpty(values.Release)) {
                    return "";
                }
                return Ext.String.format('<tr><td>Release</td><td>{0}</td></tr>', values.Release._refObjectName);
            },this),    
            getStateMessage: _.bind(function(values){
                if (Ext.isEmpty(values.State)) {
                    return "";
                }
                return Ext.String.format('<tr><td>State</td><td>{0}</td></tr>', values.State.Name);
            },this),
            getGrandparentMessage: _.bind(function(values){
                if (Ext.isEmpty(values.__GrandparentFID)) {
                    return "";
                }
                return Ext.String.format('<tr><td>Grandparent</td><td>{0}: {1}</td></tr>',values.__GrandparentFID, values.__GrandparentName);
            },this),
            getParentMessage: _.bind(function(values){
                if (Ext.isEmpty(values.__ParentFID)) {
                    return "";
                }
                return Ext.String.format('<tr><td>Parent</td><td>{0}: {1}</td></tr>',values.__ParentFID, values.__ParentName);
            },this),
            getMilestoneMessage: _.bind(function(values){
                var milestones = values.__Milestones;
                if ( Ext.isEmpty(milestones) || milestones.length === 0 ) {
                    return "";
                }
                var html = "<tr><td>Milestones</td><td>";
                Ext.Array.each(milestones, function(milestone){
                    html += Ext.String.format(" {0} ({1})<br/>",
                        milestone.Name,
                        Ext.util.Format.date(milestone.TargetDate,'d-M-Y')
                    );
                });
                html += "</td></tr>";
                return html;
            },this)
        });
    },
    
    getActualEndDateTpl: function() {
        return Ext.create('Ext.XTemplate',
            '<hr/>',
            '<h3>ACTUAL END DATE</h3>',
            '<div class="actualEndDateInfo percentDoneLine">',
                '{[this.formatDate(values.ActualEndDate)]}',
                '<tpl if="PlannedEndDate">',
                    ' ({[this.getEstimateMessage(values)]})',
                '</tpl></div>', {
            getEstimateMessage: _.bind(function(values) {
                var message;

                var actualEnd = values.ActualEndDate;
                var plannedEnd = values.PlannedEndDate;

                var diff = Rally.util.DateTime.getDifference(plannedEnd, actualEnd, 'day');
                if (diff === 0) {
                    message = 'on time';
                } else if (diff > 0) {
                    message = diff + ' day' + (diff === 1 ? '' : 's') + ' early';
                } else {
                    diff = Math.abs(diff);
                    message = diff + ' day' + (diff === 1 ? '' : 's') + ' late';
                }

                return message;
            }, this),
            formatDate: function(js_date) {
                if ( Ext.isEmpty(js_date) || !Ext.isDate(js_date) ) {
                    return "";
                }
                return Ext.util.Format.date(js_date,'d-M-Y');
            }
        });
    },

    getNotesTpl: function() {
        return Ext.create('Ext.XTemplate',
            '<hr/>',
            '<h3>NOTES</h3>',
            '<div class="percentDoneLine">{Notes}</div>');
    },

    getReleaseTpl: function() {
        return Ext.create('Ext.XTemplate',
            '<hr/>',
            '<h3>{Release.Name} ({[this.formatDate(values.Release.ReleaseStartDate)]} - {[this.formatDate(values.Release.ReleaseDate)]})</h3>',
            '<tpl if="this.shouldShowPlannedEndDateAlert(values)">',
                '<tpl if="this.showUpdateText(values)">',
                    '<div class="dangerNotification percentDoneLine">{PortfolioItemTypeName} Planned End Date:',
                        '<div>',
                            '<b>{[this.formatDate(values.PlannedEndDate)]}</b> ',
                            '<tpl if="values.canUpdate">',
                                '<a class="update-link">Update to {[this.formatDate(values.Release.ReleaseDate)]}</a>',
                            '</tpl>',
                        '</div>',
                    '</div>',
                '</tpl>',
                '<tpl if="this.showViewText(values)">',
                    '<div class="dangerNotification percentDoneLine">' +
                        '{PortfolioItemTypeName} Planned Start &amp; End Dates ',
                        '({[this.formatDate(values.PlannedStartDate)]} - {[this.formatDate(values.PlannedEndDate)]}) exist',
                        ' outside of the Release End Date.',
                        '<tpl if="values.canUpdate">',
                            '<a class="detail-link">View</a>',
                        '</tpl>',
                    '</div>',
                '</tpl>',
            '</tpl>',
            {
                formatDate: formatDate,
                showUpdateText: function(percentDoneData) {
                    var start = percentDoneData.PlannedStartDate;
                    return !start || getDate(start) <= getDate(percentDoneData.Release.ReleaseDate);
                },
                showViewText: function(percentDoneData) {
                    return !this.showUpdateText(percentDoneData);
                },
                shouldShowPlannedEndDateAlert: function(percentDoneData) {
                    return percentDoneData.instance._shouldShowReleaseSection(percentDoneData);
                }
            }
        );
    },

    getLateChildTpl: function() {
        return Ext.create('Ext.XTemplate',
            '<tpl if="this.shouldShowLateChildAlert(values)">',
                '<div class="dangerNotification percentDoneLine">' +
                    'Assigned to later releases or iterations:',
                    '<div>',
                        '<b>{LateChildCount} {[this.getUserStoriesText(values.LateChildCount)]}</b> ',
                        '<a class="late-story-view-link">View</a>',
                    '</div>',
                '</div>',
            '</tpl>',
            {
                getUserStoriesText: function(lateChildCount){
                    return lateChildCount > 1 ? 'User Stories' : 'User Story';
                },
                shouldShowLateChildAlert: function(percentDoneData) {
                    return percentDoneData.instance._shouldShowLateChildAlert(percentDoneData);
                }
            });
    }
});