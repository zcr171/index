// 历史数据处理
let historyChart = null;
let selectedDevice = null;
let historyData = [];

/**
 * 处理历史数据
 * 功能：处理从MQTT或后端API接收到的历史数据，更新历史数据存储和UI
 * 参数：
 * @param {Object} data - 历史数据对象，包含method、result等属性
 */
function processHistoryData(data) {
    console.log('处理历史数据:', data);
    if (data.result && data.result.data) {
        // 存储历史数据
        historyData = data.result.data;
        
        // 更新历史数据图表
        updateHistoryChart(data.result.data);
        
        // 更新历史数据表格
        updateHistoryTable();
    }
}

/**
 * 更新历史数据图表
 * 功能：根据历史数据更新ECharts图表显示
 * 参数：
 * @param {Array} data - 历史数据数组
 */
function updateHistoryChart(data) {
    console.log('更新历史数据图表:', data);
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
        
        // 处理数据格式
        if (Array.isArray(data)) {
            // 收集所有时间点
            const allTimePoints = new Set();
            data.forEach(item => {
                if (item.tag && item.data && Array.isArray(item.data)) {
                    item.data.forEach(point => {
                        allTimePoints.add(point.time);
                    });
                }
            });
            
            // 对时间点进行排序
            const sortedTimePoints = Array.from(allTimePoints).sort((a, b) => new Date(a) - new Date(b));
            
            // 使用排序后的时间点作为x轴标签
            labels.push(...sortedTimePoints.map(time => new Date(time).toLocaleTimeString()));
            
            // 处理每个设备的数据
            data.forEach(item => {
                if (item.tag && item.data && Array.isArray(item.data)) {
                    // 创建数据点映射
                    const dataMap = new Map();
                    item.data.forEach(point => {
                        dataMap.set(point.time, point.value);
                    });
                    
                    // 为每个时间点创建数据
                    const alignedData = sortedTimePoints.map(time => {
                        return dataMap.get(time) || null;
                    });
                    
                    // 为每个设备创建一个系列
                    series.push({
                        name: item.tag,
                        type: 'line',
                        data: alignedData,
                        symbol: 'circle',
                        symbolSize: 4,
                        lineStyle: {
                            width: 1
                        }
                    });
                }
            });
        }
        
        // 图表配置
        const option = {
            tooltip: {
                trigger: 'axis'
            },
            legend: {
                data: series.map(s => s.name),
                top: 10,
                left: 'center'
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true
            },
            xAxis: [
                {
                    type: 'category',
                    boundaryGap: false,
                    data: labels
                }
            ],
            yAxis: [
                {
                    type: 'value'
                }
            ],
            series: series
        };
        
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
 * 更新历史数据表格
 * 功能：根据历史数据使用HTML表格更新表格显示
 */
function updateHistoryTable() {
    console.log('更新历史数据表格:', historyData);
    try {
        const tableDom = document.getElementById('table-display');
        if (!tableDom) return;
        
        tableDom.innerHTML = '<div class="flex items-center justify-center h-full"><div class="text-center"><p class="text-gray-500">暂无历史数据</p></div></div>';
    } catch (error) {
        console.error('更新历史数据表格时出错:', error);
    }
}

/**
 * 搜索设备
 * 功能：根据搜索关键词查找设备
 */
function searchDevices() {
    console.log('搜索设备...');
    const searchInput = document.getElementById('device-search');
    const searchResults = document.getElementById('search-results');
    
    if (!searchInput || !searchResults) {
        console.error('搜索输入或搜索结果元素不存在');
        return;
    }
    
    const keyword = searchInput.value.trim();
    console.log('搜索关键词:', keyword);
    
    if (!keyword) {
        searchResults.classList.add('hidden');
        return;
    }
    
    // 显示搜索结果
    searchResults.innerHTML = '<div class="px-3 py-2 text-gray-500">搜索中...</div>';
    searchResults.classList.remove('hidden');
    
    // 调用后端API进行模糊搜索
    fetch(`${API_BASE_URL}/devices/search?keyword=${encodeURIComponent(keyword)}`)
        .then(response => response.json())
        .then(data => {
            console.log('搜索结果:', data);
            searchResults.innerHTML = '';
            
            if (data && data.success && data.data && data.data.length > 0) {
                data.data.forEach(device => {
                    const resultItem = document.createElement('div');
                    resultItem.className = 'px-3 py-2 hover:bg-gray-100 cursor-pointer';
                    resultItem.textContent = device.device_no || device.name || device.device_name;
                    resultItem.onclick = function() {
                        addDeviceToSelection(device.device_no || device.name || device.device_name);
                        searchResults.classList.add('hidden');
                        searchInput.value = '';
                    };
                    searchResults.appendChild(resultItem);
                });
            } else {
                searchResults.innerHTML = '<div class="px-3 py-2 text-gray-500">无匹配设备</div>';
            }
        })
        .catch(error => {
            console.error('搜索设备时出错:', error);
            searchResults.innerHTML = '<div class="px-3 py-2 text-red-500">搜索失败，请重试</div>';
        });
}

/**
 * 添加设备到选择列表
 * 功能：将设备添加到历史数据查询的已选设备列表
 * 参数：
 * @param {string} deviceName - 设备名称
 */
function addDeviceToSelection(deviceName) {
    console.log('添加设备到选择列表:', deviceName);
    const container = document.getElementById('selected-devices-container');
    const noDevicesMessage = document.getElementById('no-devices-message');
    
    if (!container || !noDevicesMessage) return;
    
    // 隐藏无设备消息
    noDevicesMessage.classList.add('hidden');
    
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
    console.log('从选择列表中移除设备:', deviceName);
    const container = document.getElementById('selected-devices-container');
    const noDevicesMessage = document.getElementById('no-devices-message');
    
    if (!container || !noDevicesMessage) return;
    
    // 找到并移除设备标签
    const deviceTag = container.querySelector(`.device-tag[data-device-name="${deviceName}"]`);
    if (deviceTag) {
        deviceTag.remove();
    }
    
    // 检查是否还有设备
    const remainingDevices = container.querySelectorAll('.device-tag');
    if (remainingDevices.length === 0) {
        noDevicesMessage.classList.remove('hidden');
    }
}

/**
 * 重置设备选择
 * 功能：清空历史数据查询的已选设备列表
 */
function resetDeviceSelection() {
    console.log('重置设备选择');
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
    console.log('切换显示模式:', mode);
    const chartDisplay = document.getElementById('chart-display');
    const tableDisplay = document.getElementById('table-display');
    const chartModeBtn = document.getElementById('chart-mode-btn');
    const tableModeBtn = document.getElementById('table-mode-btn');
    
    if (!chartDisplay || !tableDisplay || !chartModeBtn || !tableModeBtn) {
        console.error('切换按钮或显示元素不存在');
        return;
    }
    
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
 * 简单查询历史数据
 * 功能：根据选择的设备和时间范围查询历史数据
 */
function simpleQuery() {
    console.log('查询历史数据');
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
    
    // 转换时间为时间戳（毫秒）
    const startTimestamp = new Date(startTime).getTime();
    const endTimestamp = new Date(endTime).getTime();
    
    // 生成唯一序号
    const seq = Date.now();
    
    // 构建查询消息
    const queryMessage = {
        "method": "HistoryData",
        "topic": "hisdatatest",
        "names": selectedDevices,
        "seq": seq,
        "mode": 0,
        "begintime": startTimestamp,
        "endtime": endTimestamp,
        "count": 20,
        "interval": 1000,
        "timeout": 20000
    };
    
    console.log('发送历史数据查询请求到后端:', queryMessage);
    
    // 通过后端API发送历史数据查询请求
    const token = localStorage.getItem('token');
    fetch(`${API_BASE_URL}/history/data`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            device_no: selectedDevices,
            start_time: startTime,
            end_time: endTime,
            interval: interval,
            count: count
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('HTTP error ' + response.status);
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            console.log('历史数据查询请求发送成功:', data);
            alert('查询请求已发送到后端，正在处理...');
            // 后端会处理MQTT查询并返回数据
            // 这里可以添加轮询或等待后端推送数据的逻辑
        } else {
            console.error('历史数据查询请求失败:', data.message);
            alert('查询请求失败: ' + data.message);
        }
    })
    .catch(error => {
        console.error('发送历史数据查询请求失败:', error);
        alert('发送查询请求失败，请重试');
    });
}

// 将函数添加到window对象，确保在全局作用域中可用
if (typeof window !== 'undefined') {
    window.searchDevices = searchDevices;
    window.addDeviceToSelection = addDeviceToSelection;
    window.removeDeviceFromSelection = removeDeviceFromSelection;
    window.resetDeviceSelection = resetDeviceSelection;
    window.switchDisplayMode = switchDisplayMode;
    window.simpleQuery = simpleQuery;
    window.processHistoryData = processHistoryData;
}
