// 历史数据处理
let historyChart = null;

/**
 * 处理历史数据
 * 功能：处理从MQTT或后端API接收到的历史数据，更新历史数据存储和UI
 * 参数：
 * @param {Object} data - 历史数据对象，包含method、result等属性
 */
function processHistoryData(data) {
    if (data.result && data.result.data) {
        // 存储历史数据
        historyData = data.result.data;
        
        // 更新历史数据图表
        updateHistoryChart(data.result.data);
    }
}

/**
 * 更新历史数据图表
 * 功能：根据历史数据更新图表显示
 * 参数：
 * @param {Array} data - 历史数据数组
 */
function updateHistoryChart(data) {
    try {
        const ctx = document.getElementById('history-chart');
        if (!ctx) return;
        
        // 销毁现有图表
        if (historyChart) {
            historyChart.destroy();
        }
        
        // 准备图表数据
        const labels = [];
        const datasets = [];
        
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
                    
                    // 为每个设备创建一个数据集
                    datasets.push({
                        label: item.tag,
                        data: tagData,
                        borderColor: getRandomColor(),
                        backgroundColor: getRandomColor(0.1),
                        borderWidth: 1,
                        tension: 0.4,
                        pointRadius: 2,
                        pointHoverRadius: 4
                    });
                }
            });
        }
        
        // 创建图表
        historyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: '时间'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: '值'
                        },
                        beginAtZero: false
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('更新历史数据图表时出错:', error);
    }
}

/**
 * 生成随机颜色
 * 功能：为图表数据集生成随机颜色
 * 参数：
 * @param {number} alpha - 透明度，默认1
 * @returns {string} - 十六进制颜色字符串
 */
function getRandomColor(alpha = 1) {
    const r = Math.floor(Math.random() * 255);
    const g = Math.floor(Math.random() * 255);
    const b = Math.floor(Math.random() * 255);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
    
    // 从设备数据中搜索匹配的设备
    const matchedDevices = Object.keys(deviceData).filter(deviceName => 
        deviceName.toLowerCase().includes(keyword.toLowerCase()) ||
        (deviceData[deviceName].desc && deviceData[deviceName].desc.toLowerCase().includes(keyword.toLowerCase()))
    );
    
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
        searchResults.classList.add('hidden');
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
 * 功能：根据历史数据更新表格显示
 */
function updateHistoryTable() {
    try {
        const tableBody = document.getElementById('history-table-body');
        if (!tableBody) return;
        
        const fragment = document.createDocumentFragment();
        
        // 简化处理，只显示设备名称
        Object.keys(deviceData).forEach(deviceName => {
            const device = deviceData[deviceName];
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="px-3 py-2 sticky left-0 bg-gray-50 dark:bg-gray-700">${deviceName}</td>
                <td class="px-3 py-2">${device.desc || '--'}</td>
            `;
            fragment.appendChild(row);
        });
        
        // 清空表格并添加新行
        tableBody.innerHTML = '';
        tableBody.appendChild(fragment);
        
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
    
    // 向后端请求历史数据
    fetch('http://localhost:3001/api/history/batch', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            deviceTags: selectedDevices,
            startTime: startTimestamp,
            endTime: endTimestamp,
            clientId: clientId
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.code === 0 && data.result && data.result.data) {
            // 处理历史数据
            processHistoryData({ result: data.result });
        }
    })
    .catch(error => {
        console.error('查询历史数据失败:', error);
    });
}
