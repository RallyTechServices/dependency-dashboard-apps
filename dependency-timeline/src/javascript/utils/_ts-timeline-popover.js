Ext.define('CA.techservices.popover.TimelinePopover',{
    extend: 'Rally.ui.popover.PercentDonePopover',
    
    config: {
        
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
                '<div class="dangerNotification percentDoneLine">Missing Planned End Date</div>',
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

        //ajax request
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

        console.log('--', percentDoneData);
        return html;
    },
    
    getItemSummaryTpl: function() {
        return Ext.create('Ext.XTemplate',
            '<hr/>',
            '<tpl>',
            '{[this.getStateMessage(values)]}',
            '{[this.getGrandparentMessage(values)]}',
            '{[this.getParentMessage(values)]}',
            '{[this.getMilestoneMessage(values)]}',
            '</tpl>', {
            getStateMessage: _.bind(function(values){
                //console.log('values', values);
                if (Ext.isEmpty(values.State)) {
                    return "";
                }
                return Ext.String.format('State: {0}<br/>',values.State.Name);
            },this),
            getGrandparentMessage: _.bind(function(values){
                if (Ext.isEmpty(values.__GrandparentFID)) {
                    return "";
                }
                return Ext.String.format('{0}: {1}<br/>',values.__GrandparentFID, values.__GrandparentName);
            },this),
            getParentMessage: _.bind(function(values){
                if (Ext.isEmpty(values.__ParentFID)) {
                    return "";
                }
                return Ext.String.format('{0}: {1}<br/>',values.__ParentFID, values.__ParentName);
            },this),
            getMilestoneMessage: _.bind(function(values){
                var milestones = values.__Milestones;
                if ( Ext.isEmpty(milestones) || milestones.length === 0 ) {
                    return "";
                }
                var html = "Milestones:<br/>";
                Ext.Array.each(milestones, function(milestone){
                    html += Ext.String.format(" {0} ({1})<br/>",
                        milestone.Name,
                        Ext.util.Format.date(milestone.TargetDate,'d-m-Y')
                    );
                });
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

                var actualEnd = getDate(values.ActualEndDate);
                var plannedEnd = getDate(values.PlannedEndDate);

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
            formatDate: formatDate
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