// 历史数据处理
let historyChart = null;
let selectedDevice = null;

/**
 * 处理历史数据
 * 功能：处理从MQTT或后端API接收到的历史数据，更新历史数据存储和UI
 * 参数：
 * @param {Object} data - 历史数据对象，包含method、result等属性
 */
function processHistoryData(data) {
    if (data.result && data.result.data) {
        console.log('接收到的历史数据:', data.result.data);
        
        // 转换数据格式以匹配代码期望的格式
        let formattedData = data.result.data;
        
        // 检查数据格式是否需要转换
        if (Array.isArray(data.result.data) && data.result.data.length > 0) {
            const firstItem = data.result.data[0];
            if (firstItem.hasOwnProperty('name') && firstItem.hasOwnProperty('datalist')) {
                // 转换为期望的格式：[{ tag: '设备名', data: [{ time: '时间', value: '值' }, ...] }, ...]
                formattedData = data.result.data.map(item => ({
                    tag: item.name,
                    data: item.datalist.map(point => ({
                        time: point.time,
                        value: point.val
                    }))
                }));
                console.log('转换后的历史数据:', formattedData);
            }
        }
        
        // 存储历史数据
        historyData = formattedData;
        
        // 更新历史数据图表
        updateHistoryChart(formattedData);
        
        // 更新历史数据表格
        updateHistoryTable();
    } else {
        console.log('没有接收到历史数据:', data);
    }
}

/**
 * 更新历史数据图表
 * 功能：根据历史数据更新ECharts图表显示
 * 参数：
 * @param {Array} data - 历史数据数组
 */
function updateHistoryChart(data) {
    try {
        const chartDom = document.getElementById('history-chart');
        if (!chartDom) return;
        
        // 初始化ECharts实例
        if (historyChart) {
            historyChart.dispose();
        }
        historyChart = echarts.init(chartDom);
        
        // 准备图表数据
        const labels = [];
        const series = [];
        const deviceDataMap = {};
        
        // 处理数据格式
        if (Array.isArray(data)) {
            data.forEach(item => {
                if (item.tag && item.data && Array.isArray(item.data)) {
                    const tagData = item.data.map(point => point.value);
                    const tagLabels = item.data.map(point => new Date(point.time).toLocaleTimeString());
                    
                    // 只使用第一个设备的标签作为x轴
                    if (labels.length === 0) {
                        labels.push(...tagLabels);
                    }
                    
                    // 计算数据的最小值和最大值，用于归一化和后续显示
                    const values = tagData.filter(val => typeof val === 'number');
                    if (values.length > 0) {
                        const min = Math.min(...values);
                        const max = Math.max(...values);
                        const range = max - min;
                        
                        // 归一化数据到 0~100 范围
                        const normalizedData = tagData.map(val => {
                            if (typeof val !== 'number' || range === 0) return 0;
                            return ((val - min) / range) * 100;
                        });
                        
                        // 存储设备数据
                        deviceDataMap[item.tag] = {
                            min: min,
                            max: max,
                            range: range,
                            originalData: tagData,
                            normalizedData: normalizedData
                        };
                        
                        // 为每个设备创建一个系列
                        series.push({
                            name: item.tag,
                            type: 'line',
                            data: normalizedData,
                            symbol: 'circle',
                            symbolSize: 4,
                            lineStyle: {
                                width: 2,
                                type: 'solid'
                            },
                            itemStyle: {
                                opacity: 0.8
                            },
                            emphasis: {
                                focus: 'series',
                                lineStyle: {
                                    width: 4
                                },
                                itemStyle: {
                                    opacity: 1
                                }
                            }
                        });
                    }
                }
            });
        }
        
        // 生成Y轴刻度
        function generateYAxis(deviceName) {
            if (deviceName && deviceDataMap[deviceName]) {
                const deviceInfo = deviceDataMap[deviceName];
                const min = deviceInfo.min;
                const max = deviceInfo.max;
                const range = deviceInfo.range;
                
                return {
                    type: 'value',
                    min: 0,
                    max: 100,
                    interval: 25,
                    axisLabel: {
                        formatter: function(value) {
                            const actualValue = min + (value / 100) * range;
                            return actualValue.toFixed(2);
                        }
                    },
                    axisTick: {
                        show: true
                    },
                    splitLine: {
                        show: true,
                        lineStyle: {
                            type: 'dashed',
                            opacity: 0.3
                        }
                    }
                };
            } else {
                // 默认显示百分比
                return {
                    type: 'value',
                    min: 0,
                    max: 100,
                    interval: 25,
                    axisLabel: {
                        formatter: '{value}%'
                    },
                    axisTick: {
                        show: true
                    },
                    splitLine: {
                        show: true,
                        lineStyle: {
                            type: 'dashed',
                            opacity: 0.3
                        }
                    }
                };
            }
        }
        
        // 图表配置
        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'cross',
                    label: {
                        backgroundColor: '#6a7985'
                    }
                },
                formatter: function(params) {
                    let result = params[0].axisValue + '<br/>';
                    params.forEach(item => {
                        const deviceName = item.seriesName;
                        const deviceInfo = deviceDataMap[deviceName];
                        const dataIndex = item.dataIndex;
                        const originalValue = deviceInfo ? deviceInfo.originalData[dataIndex] : item.value;
                        const formattedValue = typeof originalValue === 'number' ? originalValue.toFixed(2) : originalValue;
                        result += item.marker + item.seriesName + ': ' + formattedValue + '<br/>';
                    });
                    return result;
                }
            },
            legend: {
                data: series.map(s => s.name),
                top: 10,
                left: 'center',
                selectedMode: 'single',
                textStyle: {
                    fontSize: 12
                },
                formatter: function(name) {
                    return name;
                }
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true,
                top: '15%'
            },
            xAxis: [
                {
                    type: 'category',
                    boundaryGap: false,
                    data: labels,
                    axisLabel: {
                        fontSize: 10,
                        rotate: 45
                    },
                    axisTick: {
                        alignWithLabel: true
                    }
                }
            ],
            yAxis: [
                generateYAxis(selectedDevice)
            ],
            series: series
        };
        
        // 监听图例点击事件
        historyChart.on('legendselectchanged', function(params) {
            const selectedName = Object.keys(params.selected).find(key => params.selected[key]);
            selectedDevice = selectedName;
            
            // 更新Y轴
            option.yAxis[0] = generateYAxis(selectedDevice);
            historyChart.setOption(option);
        });
        
        // 设置图表配置
        historyChart.setOption(option);
        
        // 响应式调整
        window.addEventListener('resize', function() {
            historyChart.resize();
        });
        
    } catch (error) {
        console.error('更新历史数据图表时出错:', error);
    }
}

/**
 * 生成随机颜色
 * 功能：为图表系列生成随机颜色
 * 参数：
 * @returns {string} - 十六进制颜色字符串
 */
function getRandomColor() {
    const colors = [
        '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
        '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#5470c6'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * 搜索设备
 * 功能：根据搜索关键词查找设备
 */
function searchDevices() {
    const searchInput = document.getElementById('device-search');
    const searchResults = document.getElementById('search-results');
    
    if (!searchInput || !searchResults) return;
    
    const keyword = searchInput.value.trim();
    if (!keyword) {
        searchResults.classList.add('hidden');
        return;
    }
    
    console.log('搜索设备关键词:', keyword);
    console.log('当前deviceData中的设备数量:', Object.keys(deviceData).length);
    
    // 从设备数据中搜索匹配的设备
    const matchedDevices = Object.keys(deviceData).filter(deviceName => 
        deviceName.toLowerCase().includes(keyword.toLowerCase()) ||
        (deviceData[deviceName].desc && deviceData[deviceName].desc.toLowerCase().includes(keyword.toLowerCase()))
    );
    
    console.log('搜索匹配的设备数量:', matchedDevices.length);
    console.log('匹配的设备列表:', matchedDevices);
    
    // 显示搜索结果
    searchResults.innerHTML = '';
    matchedDevices.forEach(deviceName => {
        const device = deviceData[deviceName];
        const item = document.createElement('div');
        item.className = 'px-3 py-2 hover:bg-gray-100 cursor-pointer';
        item.innerHTML = `
            <div class="font-medium">${deviceName}</div>
            <div class="text-xs text-gray-500">${device.desc || ''}</div>
        `;
        item.addEventListener('click', () => {
            // 添加设备到已选设备列表
            addDeviceToSelection(deviceName);
            searchResults.classList.add('hidden');
        });
        searchResults.appendChild(item);
    });
    
    if (matchedDevices.length > 0) {
        searchResults.classList.remove('hidden');
    } else {
        // 显示无匹配结果提示
        searchResults.innerHTML = '<div class="px-3 py-2 text-gray-500">无匹配设备</div>';
        searchResults.classList.remove('hidden');
    }
}

/**
 * 添加设备到选择列表
 * 功能：将设备添加到历史数据查询的已选设备列表
 * 参数：
 * @param {string} deviceName - 设备名称
 */
function addDeviceToSelection(deviceName) {
    const container = document.getElementById('selected-devices-container');
    const noDevicesMessage = document.getElementById('no-devices-message');
    
    if (!container || !noDevicesMessage) return;
    
    // 检查设备是否已在选择列表中
    const existingDevices = container.querySelectorAll('.device-tag');
    for (const device of existingDevices) {
        if (device.dataset.deviceName === deviceName) {
            return; // 设备已存在，不再添加
        }
    }
    
    // 隐藏无设备消息
    if (noDevicesMessage) {
        noDevicesMessage.classList.add('hidden');
    }
    
    // 创建设备标签
    const deviceTag = document.createElement('div');
    deviceTag.className = 'device-tag bg-gray-100 px-2 py-1 rounded-full text-xs flex items-center space-x-1';
    deviceTag.dataset.deviceName = deviceName;
    deviceTag.innerHTML = `
        <span>${deviceName}</span>
        <button class="text-gray-400 hover:text-gray-600" onclick="removeDeviceFromSelection('${deviceName}')">
            <i class="fa fa-times-circle"></i>
        </button>
    `;
    
    container.appendChild(deviceTag);
}

/**
 * 从选择列表中移除设备
 * 功能：从历史数据查询的已选设备列表中移除设备
 * 参数：
 * @param {string} deviceName - 设备名称
 */
function removeDeviceFromSelection(deviceName) {
    const container = document.getElementById('selected-devices-container');
    const noDevicesMessage = document.getElementById('no-devices-message');
    
    if (!container || !noDevicesMessage) return;
    
    // 找到并移除设备标签
    const deviceTag = container.querySelector(`.device-tag[data-device-name="${deviceName}"]`);
    if (deviceTag) {
        deviceTag.remove();
    }
    
    // 检查是否还有设备，如果没有，显示无设备消息
    const remainingDevices = container.querySelectorAll('.device-tag');
    if (remainingDevices.length === 0 && noDevicesMessage) {
        noDevicesMessage.classList.remove('hidden');
    }
}

/**
 * 重置设备选择
 * 功能：清空历史数据查询的已选设备列表
 */
function resetDeviceSelection() {
    const container = document.getElementById('selected-devices-container');
    const noDevicesMessage = document.getElementById('no-devices-message');
    const searchInput = document.getElementById('device-search');
    
    if (!container || !noDevicesMessage) return;
    
    // 清空设备标签
    const deviceTags = container.querySelectorAll('.device-tag');
    deviceTags.forEach(tag => tag.remove());
    
    // 显示无设备消息
    noDevicesMessage.classList.remove('hidden');
    
    // 清空搜索输入
    if (searchInput) {
        searchInput.value = '';
    }
    
    // 重置选中设备
    selectedDevice = null;
}

/**
 * 切换显示模式
 * 功能：在图表和表格之间切换历史数据显示模式
 * 参数：
 * @param {string} mode - 显示模式，可选值：'chart'、'table'
 */
function switchDisplayMode(mode) {
    const chartDisplay = document.getElementById('chart-display');
    const tableDisplay = document.getElementById('table-display');
    const chartModeBtn = document.getElementById('chart-mode-btn');
    const tableModeBtn = document.getElementById('table-mode-btn');
    
    if (!chartDisplay || !tableDisplay || !chartModeBtn || !tableModeBtn) return;
    
    if (mode === 'chart') {
        // 切换到图表模式
        chartDisplay.style.display = 'block';
        tableDisplay.style.display = 'none';
        chartModeBtn.classList.remove('border-gray-300', 'text-gray-700');
        chartModeBtn.classList.add('bg-primary', 'text-white');
        tableModeBtn.classList.remove('bg-primary', 'text-white');
        tableModeBtn.classList.add('border-gray-300', 'text-gray-700');
    } else if (mode === 'table') {
        // 切换到表格模式
        chartDisplay.style.display = 'none';
        tableDisplay.style.display = 'block';
        tableModeBtn.classList.remove('border-gray-300', 'text-gray-700');
        tableModeBtn.classList.add('bg-primary', 'text-white');
        chartModeBtn.classList.remove('bg-primary', 'text-white');
        chartModeBtn.classList.add('border-gray-300', 'text-gray-700');
        
        // 更新历史数据表格
        updateHistoryTable();
    }
}

/**
 * 更新历史数据表格
 * 功能：根据历史数据使用ECharts表格组件更新表格显示
 */
function updateHistoryTable() {
    try {
        const tableDom = document.getElementById('table-display');
        if (!tableDom) return;
        
        // 清空表格容器
        tableDom.innerHTML = '<div id="history-table" class="w-full h-full"></div>';
        
        const chartDom = document.getElementById('history-table');
        if (!chartDom) return;
        
        // 初始化ECharts实例
        const tableChart = echarts.init(chartDom);
        
        // 检查是否有历史数据
        if (historyData && Array.isArray(historyData) && historyData.length > 0) {
            // 收集所有唯一的时间点并按时间排序
            const timePoints = new Set();
            historyData.forEach(item => {
                if (item.data && Array.isArray(item.data)) {
                    item.data.forEach(point => {
                        timePoints.add(point.time);
                    });
                }
            });
            
            // 转换为数组并按时间排序
            const sortedTimes = Array.from(timePoints).sort((a, b) => new Date(a) - new Date(b));
            
            // 准备表格数据
            const headers = ['位号'];
            sortedTimes.forEach(time => {
                headers.push(new Date(time).toLocaleTimeString());
            });
            
            const rows = [];
            historyData.forEach(item => {
                if (item.tag && item.data && Array.isArray(item.data)) {
                    const row = [item.tag];
                    sortedTimes.forEach(time => {
                        // 查找对应时间点的数据
                        const point = item.data.find(p => p.time === time);
                        if (point) {
                            row.push(typeof point.value === 'number' ? point.value.toFixed(2) : point.value);
                        } else {
                            row.push('--');
                        }
                    });
                    rows.push(row);
                }
            });
            
            // 表格配置
            const option = {
                tooltip: {
                    position: 'top'
                },
                grid: {
                    left: '3%',
                    right: '4%',
                    bottom: '3%',
                    containLabel: true
                },
                xAxis: {
                    type: 'category',
                    data: headers,
                    axisLabel: {
                        rotate: 45,
                        fontSize: 10
                    }
                },
                yAxis: {
                    type: 'category',
                    data: rows.map(row => row[0]),
                    axisLabel: {
                        fontSize: 10
                    }
                },
                visualMap: {
                    show: false
                },
                series: [
                    {
                        name: '历史数据',
                        type: 'custom',
                        renderItem: function(params, api) {
                            const categoryIndex = api.value(0);
                            const dataIndex = api.value(1);
                            const value = api.value(2);
                            
                            const xValue = api.coord([api.value(1), categoryIndex])[0];
                            const yValue = api.coord([api.value(1), categoryIndex])[1];
                            const width = api.size([1, 0])[0];
                            const height = api.size([0, 1])[1];
                            
                            return {
                                type: 'rect',
                                shape: {
                                    x: xValue - width / 2,
                                    y: yValue - height / 2,
                                    width: width,
                                    height: height
                                },
                                style: {
                                    fill: '#fff',
                                    stroke: '#e8e8e8',
                                    lineWidth: 1
                                }
                            };
                        },
                        itemStyle: {
                            opacity: 0.8
                        },
                        encode: {
                            x: 1,
                            y: 0,
                            tooltip: [2]
                        },
                        data: []
                    }
                ]
            };
            
            // 准备表格数据
            const tableData = [];
            rows.forEach((row, rowIndex) => {
                row.forEach((cell, cellIndex) => {
                    if (cellIndex > 0) {
                        tableData.push([rowIndex, cellIndex, cell]);
                    }
                });
            });
            
            option.series[0].data = tableData;
            
            // 设置表格配置
            tableChart.setOption(option);
            
            // 响应式调整
            window.addEventListener('resize', function() {
                tableChart.resize();
            });
            
        } else {
            // 显示无数据提示
            const option = {
                title: {
                    text: '暂无历史数据',
                    left: 'center',
                    top: 'center',
                    textStyle: {
                        color: '#999',
                        fontSize: 14
                    }
                }
            };
            tableChart.setOption(option);
        }
        
    } catch (error) {
        console.error('更新历史数据表格时出错:', error);
    }
}

/**
 * 简单查询历史数据
 * 功能：根据选择的设备和时间范围查询历史数据
 */
function simpleQuery() {
    const startTime = document.getElementById('history-start-time').value;
    const endTime = document.getElementById('history-end-time').value;
    const container = document.getElementById('selected-devices-container');
    const deviceTags = container.querySelectorAll('.device-tag');
    
    // 收集选中的设备
    const selectedDevices = [];
    deviceTags.forEach(tag => {
        selectedDevices.push(tag.dataset.deviceName);
    });
    
    if (selectedDevices.length === 0) {
        alert('请至少选择一个设备');
        return;
    }
    
    if (!startTime || !endTime) {
        alert('请选择时间范围');
        return;
    }
    
    // 转换时间格式
    const startTimestamp = new Date(startTime).getTime();
    const endTimestamp = new Date(endTime).getTime();
    
    // 生成查询序号
    const seq = Date.now();
    
    // 构建用户要求的查询格式
    const queryData = {
        method: "HistoryData",
        topic: "hisdatatest",
        names: selectedDevices,
        seq: seq,
        mode: 0,
        begintime: startTimestamp,
        endtime: endTimestamp,
        count: 20,
        interval: 1000,
        timeout: 20000
    };
    
    console.log('发送历史数据查询请求:', queryData);
    
    // 通过MQTT publish到SupconScadaHisData主题
    if (mqttClient && mqttClient.connected) {
        console.log('通过MQTT发送历史数据查询请求到SupconScadaHisData主题');
        mqttClient.publish('SupconScadaHisData', JSON.stringify(queryData), function(err) {
            if (err) {
                console.error('MQTT发布失败:', err);
            } else {
                console.log('MQTT发布成功');
            }
        });
    } else {
        console.error('MQTT未连接，无法发送历史数据查询请求');
        // 如果MQTT未连接，回退到HTTP请求
        // 为HTTP请求构建符合后端API期望的格式
        const httpQueryData = {
            deviceTags: selectedDevices,
            startTime: startTimestamp,
            endTime: endTimestamp,
            clientId: clientId
        };
        
        fetch('http://localhost:3002/api/history/batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(httpQueryData)
        })
        .then(response => response.json())
        .then(data => {
            console.log('收到历史数据查询响应:', data);
            if (data.code === 0 && data.result && data.result.data) {
                // 处理历史数据
                processHistoryData({ result: data.result });
            }
        })
        .catch(error => {
            console.error('查询历史数据失败:', error);
        });
    }
}

// 数据替换位置说明：
// 1. 在processHistoryData函数中，historyData变量存储了从后端获取的历史数据
// 2. 在updateHistoryChart函数中，data参数是历史数据数组，格式如下：
// [
//   {
//     tag: '设备位号1',
//     data: [
//       { time: '时间戳', value: 数值 },
//       { time: '时间戳', value: 数值 },
//       ...
//     ]
//   },
//   {
//     tag: '设备位号2',
//     data: [
//       { time: '时间戳', value: 数值 },
//       { time: '时间戳', value: 数值 },
//       ...
//     ]
//   },
//   ...
// ]
// 3. 只需将上述格式的数据传递给processHistoryData函数即可
// 4. 如果需要直接测试，可以修改updateHistoryChart函数中的data变量为测试数据

// 将函数添加到window对象，确保在全局作用域中可用
if (typeof window !== 'undefined') {
    window.searchDevices = searchDevices;
    window.addDeviceToSelection = addDeviceToSelection;
    window.removeDeviceFromSelection = removeDeviceFromSelection;
    window.resetDeviceSelection = resetDeviceSelection;
    window.switchDisplayMode = switchDisplayMode;
    window.simpleQuery = simpleQuery;
}
