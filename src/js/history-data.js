// 历史数据全局变量
window.historyChart = null;
window.selectedDevices = new Map(); // 已选设备 Map<deviceName, deviceInfo>
let historyData = [];
let selectedSeriesName = null; // 当前选中的曲线名称
const MAX_SELECTED_DEVICES = 8; // 最多选择8个设备
const CHART_COLORS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728',
    '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'
];

/**
 * 页面初始化
 */
document.addEventListener('DOMContentLoaded', () => {
    // 初始化默认时间：结束时间为当前时间，开始时间往前推1小时
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    document.getElementById('history-end-time').value = now.toISOString().slice(0, 16);
    document.getElementById('history-start-time').value = oneHourAgo.toISOString().slice(0, 16);
    
    // 点击页面其他地方关闭搜索结果
    document.addEventListener('click', (e) => {
        const searchContainer = document.querySelector('.relative');
        const searchResults = document.getElementById('search-results');
        if (searchContainer && !searchContainer.contains(e.target)) {
            searchResults.classList.add('hidden');
        }
    });
    
    // 监听窗口大小变化，自动调整图表大小
    window.addEventListener('resize', () => {
        if (historyChart) {
            historyChart.resize();
        }
    });
    
    // 回车搜索
    document.getElementById('device-search')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchDevices();
        }
    });
    
    // 绑定其他按钮事件
    document.getElementById('reset-devices-btn')?.addEventListener('click', resetDeviceSelection);
    document.getElementById('query-history-btn')?.addEventListener('click', simpleQuery);
    document.getElementById('chart-mode-btn')?.addEventListener('click', () => switchDisplayMode('chart'));
    document.getElementById('table-mode-btn')?.addEventListener('click', () => switchDisplayMode('table'));
});



/**
 * 添加设备到已选列表
 */
window.addDeviceToSelection = function(deviceName, deviceInfo) {
    if (selectedDevices.size >= MAX_SELECTED_DEVICES) {
        alert(`最多只能选择${MAX_SELECTED_DEVICES}个设备`);
        return;
    }
    
    if (!selectedDevices.has(deviceName)) {
        // 分配颜色
        const colorIndex = selectedDevices.size % CHART_COLORS.length;
        selectedDevices.set(deviceName, {
            ...deviceInfo,
            color: CHART_COLORS[colorIndex]
        });
        
        updateSelectedDevicesContainer();
    }
}

/**
 * 更新已选设备显示容器
 */
window.updateSelectedDevicesContainer = function() {
    const container = document.getElementById('selected-devices-container');
    const noDevicesMessage = document.getElementById('no-devices-message');
    
    if (selectedDevices.size === 0) {
        noDevicesMessage.classList.remove('hidden');
        container.innerHTML = '';
        container.appendChild(noDevicesMessage);
        return;
    }
    
    noDevicesMessage.classList.add('hidden');
    container.innerHTML = '';
    
    selectedDevices.forEach((device, deviceName) => {
        const tag = document.createElement('div');
        tag.className = 'flex items-center justify-between bg-gray-100 rounded px-1.5 py-0.5 text-xs';
        tag.innerHTML = `
            <span class="truncate" title="${deviceName}">${deviceName}</span>
            <button onclick="removeDeviceFromSelection('${deviceName}')" class="ml-1 text-gray-500 hover:text-red-500">
                <i class="fa fa-times-circle"></i>
            </button>
        `;
        tag.style.borderLeft = `3px solid ${device.color}`;
        container.appendChild(tag);
    });
}

/**
 * 从已选列表移除设备
 */
window.removeDeviceFromSelection = function(deviceName) {
    selectedDevices.delete(deviceName);
    updateSelectedDevicesContainer();
    // 如果当前选中的是被删除的曲线，取消选中
    if (selectedSeriesName === deviceName) {
        selectedSeriesName = null;
    }
}

/**
 * 重置设备选择
 */
window.resetDeviceSelection = function() {
    selectedDevices.clear();
    selectedSeriesName = null;
    updateSelectedDevicesContainer();
    if (historyChart) {
        historyChart.clear();
    }
}

/**
 * 切换显示模式
 */
window.switchDisplayMode = function(mode) {
    const chartBtn = document.getElementById('chart-mode-btn');
    const tableBtn = document.getElementById('table-mode-btn');
    const chartDisplay = document.getElementById('chart-display');
    const tableDisplay = document.getElementById('table-display');
    
    if (mode === 'chart') {
        chartBtn.classList.add('bg-primary', 'text-white');
        chartBtn.classList.remove('border', 'border-gray-300', 'text-gray-700');
        tableBtn.classList.remove('bg-primary', 'text-white');
        tableBtn.classList.add('border', 'border-gray-300', 'text-gray-700');
        chartDisplay.classList.remove('hidden');
        tableDisplay.style.display = 'none';
        if (historyChart) {
            historyChart.resize();
        }
    } else {
        tableBtn.classList.add('bg-primary', 'text-white');
        tableBtn.classList.remove('border', 'border-gray-300', 'text-gray-700');
        chartBtn.classList.remove('bg-primary', 'text-white');
        chartBtn.classList.add('border', 'border-gray-300', 'text-gray-700');
        chartDisplay.classList.add('hidden');
        tableDisplay.style.display = 'block';
        updateHistoryTable();
    }
}

/**
 * 简单查询 - 对接真实MQTT历史数据查询
 */
window.simpleQuery = function() {
    if (selectedDevices.size === 0) {
        alert('请先选择要查询的设备');
        return;
    }
    
    const startTimeStr = document.getElementById('history-start-time').value;
    const endTimeStr = document.getElementById('history-end-time').value;
    
    if (!startTimeStr || !endTimeStr) {
        alert('请选择时间范围');
        return;
    }
    
    const startTime = new Date(startTimeStr).getTime();
    const endTime = new Date(endTimeStr).getTime();
    
    if (startTime >= endTime) {
        alert('开始时间不能晚于结束时间');
        return;
    }

    // 收集已选设备
    const deviceNames = Array.from(selectedDevices.keys());
    
    // 构造查询消息，完全按照给定格式
    const queryMsg = {
        method: "HistoryData",
        topic: "hisdatatest",
        names: deviceNames,
        seq: Date.now(), // 用当前时间戳作为唯一序号
        mode: 0,
        begintime: startTime,
        endtime: endTime,
        count: 1000, // 查询最多1000个点
        interval: 1000, // 时间间隔1秒
        timeout: 20000
    };
    
    // 通过WebSocket发送给后端，后端发布到SupconScadaHisData主题
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
            type: 'publish_mqtt',
            topic: 'SupconScadaHisData',
            payload: queryMsg
        }));
        alert('查询请求已发送，请稍候...');
    } else {
        alert('WebSocket连接已断开，请刷新页面重试');
    }
}

/**
 * 模拟历史数据查询（实际项目替换为MQTT发布）
 */
window.simulateHistoryDataQuery = function(devices, startTime, endTime) {
    // 生成模拟数据
    const mockData = devices.map(deviceName => {
        const device = selectedDevices.get(deviceName);
        const min = device.minRange || 0;
        const max = device.maxRange || 100;
        const data = [];
        
        // 每5分钟一个数据点
        const start = new Date(startTime);
        const end = new Date(endTime);
        let current = new Date(start);
        
        while (current <= end) {
            // 生成在量程范围内的随机值
            const value = min + Math.random() * (max - min);
            data.push({
                time: current.toISOString(),
                value: parseFloat(value.toFixed(2))
            });
            current.setMinutes(current.getMinutes() + 5);
        }
        
        return {
            tag: deviceName,
            data: data
        };
    });
    
    // 模拟延迟，模拟MQTT返回
    setTimeout(() => {
        processHistoryData({
            result: {
                data: mockData
            }
        });
    }, 500);
}

/**
 * 处理历史数据（重构版本）
 */
window.processHistoryData = function(message) {
    console.log('收到历史数据返回:', message);
    try {
        // 后端推送的结构是 {type: 'history_data', data: <MQTT返回数据>}
        const mqttData = message.data || message;
        if (mqttData.result && mqttData.result.data) {
            const historyData = mqttData.result.data;
            window.historyData = historyData;
            // 渲染图表和表格
            window.updateHistoryChart(historyData);
            window.updateHistoryTable(historyData);
            // 自动切换到图表视图
            window.switchDisplayMode('chart');
            console.log('历史数据渲染完成，共', historyData.length, '个设备');
        } else {
            console.error('历史数据格式错误:', message);
            alert('历史数据格式错误，请检查返回内容');
        }
    } catch (error) {
        console.error('处理历史数据失败:', error);
        alert('处理历史数据失败');
    }
}

/**
 * 切换图表高亮显示
 */
window.toggleSeriesHighlight = function(params) {
    // 获取点击的图例名称
    selectedSeriesName = Object.keys(params.selected).find(name => params.selected[name]);
    // 重新渲染图表，选中的曲线加粗
    updateHistoryChart(historyData);
}

/**
 * 更新历史数据图表（重构版本）
 */
window.updateHistoryChart = function(data) {
    console.log('更新历史数据图表:', data);
    if (!data || !Array.isArray(data) || data.length === 0) {
        console.log('无历史数据可显示');
        return;
    }
    
    try {
        const chartDom = document.getElementById('history-chart');
        if (!chartDom) return;
        
        // 销毁旧实例
        if (window.historyChart) {
            window.historyChart.dispose();
        }
        
        // 初始化新实例
        window.historyChart = echarts.init(chartDom);
        
        // 1. 收集所有时间点并排序
        const allTimes = new Set();
        data.forEach(device => {
            if (device.datalist && Array.isArray(device.datalist)) {
                device.datalist.forEach(p => allTimes.add(p.time));
            }
        });
        const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);
        const xAxisData = sortedTimes.map(t => new Date(t).toLocaleTimeString());
        
        // 2. 处理每个设备的系列数据
        const series = [];
        const CHART_COLORS = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4'];
        
        data.forEach((device, index) => {
            if (!device.name || !device.datalist) return;
            
            // 数据映射
            const valueMap = new Map();
            device.datalist.forEach(p => valueMap.set(p.time, p.val));
            
            // 对齐时间点
            const seriesData = sortedTimes.map(t => valueMap.get(t) || null);
            
            // 检查是否选中
            const isSelected = window.selectedSeriesName === device.name;
            
            series.push({
                name: device.name,
                type: 'line',
                data: seriesData,
                smooth: true,
                color: CHART_COLORS[index % CHART_COLORS.length],
                lineStyle: {
                    width: isSelected ? 3 : 1.5
                },
                emphasis: {
                    focus: 'series'
                }
            });
        });
        
        // 3. 图表配置（最大化利用空间，减少空白）
        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' }
            },
            legend: {
                top: 8,
                left: 'center',
                type: 'scroll',
                itemWidth: 12,
                itemHeight: 12,
                textStyle: { fontSize: 11 }
            },
            grid: {
                left: 35,
                right: 15,
                top: 40,
                bottom: 25,
                containLabel: true
            },
            xAxis: {
                type: 'category',
                data: xAxisData,
                boundaryGap: false,
                axisLabel: { fontSize: 10 }
            },
            yAxis: {
                type: 'value',
                scale: true, // 自动适配每个曲线的量程范围
                axisLabel: { fontSize: 10 },
                splitLine: { lineStyle: { type: 'dashed' } }
            },
            series: series
        };
        
        window.historyChart.setOption(option);
        
        // 绑定事件
        window.historyChart.on('legendselectchanged', (params) => {
            window.selectedSeriesName = Object.keys(params.selected).find(name => params.selected[name]);
            window.updateHistoryChart(data); // 重新渲染高亮
        });
        
        // 自适应大小
        setTimeout(() => window.historyChart.resize(), 100);
        window.addEventListener('resize', () => window.historyChart?.resize());
        
    } catch (error) {
        console.error('渲染图表失败:', error);
    }
}

/**
 * 更新历史数据表格（重构版本）
 */
window.updateHistoryTable = function(data = historyData) {
    console.log('更新历史数据表格:', data);
    const tableContainer = document.getElementById('table-display');
    if (!tableContainer) return;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
        tableContainer.innerHTML = '<div class="flex items-center justify-center h-full"><div class="text-center"><p class="text-gray-500">暂无历史数据</p></div></div>';
        return;
    }
    
    try {
        // 1. 收集所有时间点并排序
        const allTimes = new Set();
        data.forEach(device => {
            if (device.datalist && Array.isArray(device.datalist)) {
                device.datalist.forEach(p => allTimes.add(p.time));
            }
        });
        const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);
        
        // 2. 生成表格HTML
        let html = `
            <table class="w-full text-xs table-fixed">
                <thead class="sticky top-0 bg-gray-50 z-10">
                    <tr>
                        <th class="w-28 px-2 py-1.5 border border-gray-200 text-left font-medium">时间</th>
        `;
        
        // 添加设备名列
        data.forEach(device => {
            html += `<th class="px-2 py-1.5 border border-gray-200 text-left font-medium">${device.name}</th>`;
        });
        
        html += `
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
        `;
        
        // 生成每行数据
        sortedTimes.forEach(time => {
            html += `
                <tr class="hover:bg-gray-50">
                    <td class="px-2 py-1 border border-gray-200">${new Date(time).toLocaleString()}</td>
            `;
            
            data.forEach(device => {
                const point = device.datalist.find(p => p.time === time);
                html += `<td class="px-2 py-1 border border-gray-200">${point ? point.val : '-'}</td>`;
            });
            
            html += `</tr>`;
        });
        
        html += `
                </tbody>
            </table>
        `;
        
        tableContainer.innerHTML = html;
        
    } catch (error) {
        console.error('渲染表格失败:', error);
        tableContainer.innerHTML = '<div class="flex items-center justify-center h-full"><div class="text-center"><p class="text-red-500">表格加载失败</p></div></div>';
    }
}

// 历史数据处理函数，供MQTT消息回调调用
window.processHistoryData = processHistoryData;