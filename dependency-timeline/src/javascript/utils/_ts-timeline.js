Ext.define('CA.technicalservices.AlternativeTimeline',{
    extend: 'Ext.container.Container',
    alias: 'widget.tsalternativetimeline',
    
    layout: 'border', 
    
    items: [
        {xtype:'container', itemId:'vertical_scroll_box', region: 'west', layout: 'vbox' },
        {xtype:'container', itemId:'display_box',  region:'center'}
    ],
    
    config: {
        records: [],
        
        chartStartDate: Rally.util.DateTime.add(new Date(),'month', -3),
        
        pageSize: 7,
        
        plannedStartField: 'PlannedStartDate',
        plannedEndField  : 'PlannedEndDate',
        
        actualStartField : 'ActualStartDate',
        actualEndField   : 'ActualEndDate',
        
        allowHorizontalScroll : false // not yet implemented
    },

    initComponent: function() {
        this.callParent(arguments);

        this.chartStartDate = this._moveToStartOfMonth(this.chartStartDate);
        
        this._buildChart(this.records);
    },
    
    _moveToStartOfMonth: function(start_date) {
        var day_of_month = start_date.getDate();
        var shift = -1 * ( day_of_month - 1 );         
        return Rally.util.DateTime.add(start_date, 'day', shift);
    },
    
    _buildChart: function(records) {
        this._processItems(records);
        
        if ( this.records.length - 1 < this.pageSize) {
            this.pageSize = this.records.length - 1;
        }
        
        var vertical_scroll_box = this.down('#vertical_scroll_box');
        
        var display_box  = this.down('#display_box');
        
        vertical_scroll_box.add(this._getUpButtonConfig());
        vertical_scroll_box.add({ xtype:'container', flex: 1 });
        vertical_scroll_box.add(this._getDownButtonConfig());
                
        
        if ( this.allowHorizontalScroll ) {
            var horizontal_scroll_box = this.add({
                xtype:'container', 
                itemId:'horizontal_scroll_box', 
                region: 'south', 
                layout: 'hbox'
            });
            
            horizontal_scroll_box.add(this._getLeftButtonConfig());
            horizontal_scroll_box.add({ xtype:'container', flex: 1 });
            horizontal_scroll_box.add(this._getRightButtonConfig());
        }
        
        this.highchart = display_box.add(this._getTimelineConfig());
    },
    
    _getTimelineConfig: function() {
        var config = {
            xtype: 'rallychart',
            region:'center',
           
            loadMask: false,
            chartData: this._getChartData(),
            chartColors: Rally.techservices.Colors.getTimelineColors(),
            chartConfig: this._getChartConfig()
        };
        
        if ( this.height ) { config.height = this.height - 10; }
        
        return config;
    },
    
    _processItems: function(records) {
        
        this.dateCategories = this._getDateCategories();
        
        this.categories = Ext.Array.map(records, function(record) { 
            return Ext.String.format( '{0}: {1}',
                record.get('FormattedID'),
                record.get('Name')
            );
        });
                
        var planned_series = { 
            name: 'Planned',
            data: this._getPlannedRangesFromItems(records,this.dateCategories)
        };
        
        var actual_series = {
            name: 'Actual',
            data: this._getActualRangesFromItems(records, this.dateCategories)
        };
        
        this.series = [
            actual_series,
            planned_series
        ];
    },
    
    _getDateCategories: function() {
        var start_date = this.chartStartDate;
        
        return Ext.Array.map( _.range(0,365), function(index) {
            var date = Rally.util.DateTime.add(start_date, 'day', index);
            return this._getCategoryFromDate(date);
        },this);
    },
   
    _getCategoryFromDate: function(date) {
        return Ext.Date.format(date, 'Y-m-d');
    },
    
    _getPositionOnTimeline: function(categories, date) {
        var category_date = this._getCategoryFromDate(date);
        
        var index = Ext.Array.indexOf(categories,category_date);
        
        if ( index > -1 ) { return index; }
        
        if (category_date > categories[categories.length-1] ) { return categories.length-1; }
        
        return 0;
    },
    
    _getPlannedRangesFromItems: function(items, categories) {
        var plannedStartField = this.plannedStartField;
        var plannedEndField   = this.plannedEndField;
        
        return Ext.Array.map(items, function(item) {
            var start_index = this._getPositionOnTimeline(categories, item.get(plannedStartField) );
            var end_index   = this._getPositionOnTimeline(categories, item.get(plannedEndField) );
            
            return [ start_index, end_index ];
        },this);
    },
    
    _getActualRangesFromItems: function(items, categories) {
        var actualStartField = this.actualStartField;
        var actualEndField = this.actualEndField;
        
        return Ext.Array.map(items, function(item) {
            var start_index = this._getPositionOnTimeline(categories,item.get(actualStartField));
            var end_index   = this._getPositionOnTimeline(categories,item.get(actualEndField));
            
            
            if ( Ext.isEmpty(item.get(actualStartField) ) ) {
                start_index = null;
            }
            
            if ( Ext.isEmpty(item.get(actualEndField)) ) {
                end_index = this._getPositionOnTimeline(categories,new Date());
            }
            return [ start_index, end_index ];
        },this);
    },
    
    /**
     * Generate x axis categories and y axis series data for the chart
     * (This chart is sideways, so categories represent the vertical axis)
     */
    _getChartData: function() {
        
        return {
            categories: this.categories,
            //min: min,
            series: this.series
        };
    },
    
    _getExtremes: function(chart, id) {
        var axis = chart.get(id); // must set the axis' id property
        return axis.getExtremes();
    },

    _getPlotBands: function() {
        var me = this;
        var start_date = me.chartStartDate;
        var bands = Ext.Array.map( _.range(0,12), function(index) {
            var band_start_date = Rally.util.DateTime.add(start_date, 'month', index);
            var band_end_date = Rally.util.DateTime.add(band_start_date, 'month', 1);
            
            var value = Ext.Date.format(band_start_date,'M');
            
            var to = Ext.Array.indexOf(me.dateCategories,me._getCategoryFromDate(band_end_date)) - 1;
            if ( to < 0 ) { to = 364; }
            
            return {
                color: '#eee',
                from: Ext.Array.indexOf(me.dateCategories,me._getCategoryFromDate(band_start_date)) +1,
                to: to,
                label: {
                    text: value,
                    align: 'center',
                    y: -2
                },
                zIndex: 3
            }
        },this);
        
        return bands;
    },
    
    _getPlotLines: function() {
        var me = this;
        
        var start_date = me.chartStartDate;
        var month_lines = Ext.Array.map( _.range(0,12), function(index) {
            var date = Rally.util.DateTime.add(start_date, 'month', index);
            var value = Ext.Date.format(date,'z');
            
            return {
                color: '#ccc',
                width: 1,
                value: value
            }
        },this);
                
        var today_line = {
            color: '#c00',
            width: 1,
            value: Ext.Array.indexOf(me.dateCategories,me._getCategoryFromDate(new Date())),
            zIndex: 4
        };
        
        return Ext.Array.merge( month_lines, today_line );
    },
    
    
    /**
     * Generate a valid Highcharts configuration object to specify the column chart
     */
    _getChartConfig: function() {
        var me = this;
        
        var max = this.pageSize;
        
        var chart_config = {
            chart: {
                inverted: true,
                type: 'columnrange',
                events: {
                    load: function(evt) {
                        me._setChart(this);
                    }
                }
            },
            title: {
                text: ''
            },
            subtitle: {
                text: ''
            },
            xAxis: {
                min: 0,
                id: 'xAxis',
                max: max
            },
            yAxis: {
                id: 'yAxis',
                tickInterval: 366,
                categories: this.categories,
                min: 0,
                max: 366,
                title: {
                    text: ' '
                },
                plotBands: this._getPlotBands(),
                plotLines: this._getPlotLines(),
                labels: {
                    align: 'right',
                    formatter: function() {
                        return "";
                    }
                }
            },

            tooltip: {
                headerFormat: '<span style="font-size:10px">{point.key}</span><table>',
                    pointFormat: '<tr><td style="color:{series.color};padding:0">{series.name}: </td>' +
                    '<td style="padding:0"><b>{point.y:.1f} mm</b></td></tr>',
                    footerFormat: '</table>',
                    shared: true,
                    useHTML: true,
                    enabled: false
            },
            
            legend: { enabled: false },
            
            plotOptions: {

                columnrange: {
                    dataLabels: {
                        enabled: false,
                        formatter: function() { return this.y + "!"; }
                    }
                },
                
                series: {
                    pointPadding: 0
                }
            }
        };
        
        return chart_config;
    },
    
    _setChart: function(chart) {
        this.highchart = chart;
        this._enableChartButtons();
    },
    
    _enableChartButtons: function() {
        var up_button = this.down('#up_button');
        var down_button = this.down('#down_button');
        
        up_button.setDisabled(true);
        down_button.setDisabled(true);
        
        if ( this.allowHorizontalScroll ) {
            
        }
        
        if ( this.highchart ) {
            var vertical_extremes = this._getExtremes(this.highchart,'xAxis');
            
            if ( vertical_extremes.min > 0 ) {
                up_button.setDisabled(false);
            }
            
            if ( vertical_extremes.max < vertical_extremes.dataMax ) {
                down_button.setDisabled(false);
            }
            
        }
    },
    
    _getLeftButtonConfig: function() {
        return { 
            xtype:'rallybutton', 
            itemId: 'left_button', 
            text: '<span class="icon-left"> </span>', 
            disabled: false, 
            cls: 'secondary small',
            margin: '5 0 3 200',
            listeners: {
                scope: this,
                click: function() {
                    if ( this.highchart ) {
                        this._scrollUp(this.highchart);
                    }
                }
            }
        };
    },
    
    _getRightButtonConfig: function() {
        return { 
            xtype:'rallybutton', 
            itemId: 'right_button', 
            text: '<span class="icon-right"> </span>', 
            disabled: false, 
            cls: 'secondary small',
            margin: '5 10 3 0',
            listeners: {
                scope: this,
                click: function() {
                    if ( this.highchart ) {
                        this._scrollRight(this.highchart);
                    }
                }
            }
        };
    },
    
    _getUpButtonConfig: function() {
        return { 
            xtype:'rallybutton', 
            itemId: 'up_button', 
            text: '<span class="icon-up"> </span>', 
            disabled: true, 
            cls: 'secondary small',
            listeners: {
                scope: this,
                click: function() {
                    if ( this.highchart ) {
                        this._scrollUp(this.highchart);
                    }
                }
            }
        };
    },
    
    _getDownButtonConfig: function() {
        return { 
            xtype:'rallybutton', 
            itemId: 'down_button', 
            text: '<span class="icon-down"> </span>', 
            disabled: true, 
            cls: 'secondary small',
            margin: '0 0 2 0',
            listeners: {
                scope: this,
                click: function() {
                    if ( this.highchart ) {
                        this._scrollDown(this.highchart);
                    }
                }
            }
        };
    },
    
    _setExtremes: function(chart, id, min, max) {
        var axis = chart.get(id); // must set the axis' id property
        var extremes = this._getExtremes(chart,id);
        
        axis.setExtremes(min,max);
        this._enableChartButtons();
    },
        
    _scrollRight: function(chart) {
//        var extremes = this._getExtremes(chart,'xAxis');
//        var new_max = extremes.max - 1;
//        var new_min = extremes.min - 1;
//        
//        if ( new_min < 0 ) { new_min = 0; }
//        if ( new_max < new_min + this.pageSize - 1) { 
//            new_max = new_min + this.pageSize - 1;
//        }
//        
//        this._setExtremes(chart,'xAxis',new_min,new_max);
    },
    
    _scrollUp: function(chart) {
        var extremes = this._getExtremes(chart,'xAxis');
        var new_max = extremes.max - 1;
        var new_min = extremes.min - 1;
        
        if ( new_min < 0 ) { new_min = 0; }
        if ( new_max < new_min + this.pageSize - 1) { 
            new_max = new_min + this.pageSize - 1;
        }
        
        this._setExtremes(chart,'xAxis',new_min,new_max);
    },
    
    _scrollDown: function(chart) {
        var extremes = this._getExtremes(chart,'xAxis');
        var new_max = extremes.max + 1;
        var new_min = extremes.min + 1;
        
        //if ( new_max > extremes.dataMax ) { new_max = extremes.dataMax; }
        if ( new_min > new_max - this.pageSize + 1 ) { 
            new_min =  new_max - this.pageSize + 1;
            if ( new_min < 0 ) { new_min = 0; }
        }
        
        this._setExtremes(chart,'xAxis',new_min,new_max);
    }
    
    
});