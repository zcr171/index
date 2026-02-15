// 导出设备清单的时间戳，用于控制导出频率
let lastExportTime = 0;
const EXPORT_INTERVAL = 60000; // 导出间隔，1分钟
let simulationInterval = null;

/**
 * 处理实时数据
 * 功能：处理从MQTT接收到的设备实时数据，更新设备数据存储和UI
 * 参数：
 * @param {Object} data - 设备实时数据对象，包含name、value等属性
 * 实现：
 * 1. 验证数据格式，确保包含设备名称
 * 2. 存储设备数据，包括基本参数、报警阈值等
 * 3. 检查设备值是否在报警范围内
 * 4. 必要时创建新的报警记录
 * 5. 更新设备数据表格和历史数据设备选择
 * 6. 更新综合概况页面统计数据
 */
function processRealTimeData(data) {
    // 检查数据是否包含clientId，并且与当前客户端ID匹配
    if (data.clientId && data.clientId !== clientId) {
        console.log('忽略其他客户端的实时数据:', data.clientId, '(当前客户端:', clientId, ')');
        return;
    }
    
    if (data.name) {
        const deviceName = data.name;
        if (!deviceData[deviceName]) {
            // 如果设备不存在，创建新设备记录
            deviceData[deviceName] = {
                // 基本参数
                value: data.value || 0,
                type: data.type || null,
                quality: data.quality || null,
                timestamp: data.timestamp || null,
                desc: data.desc || '',
                unit: '',
                
                // 报警阈值
                hhValue: data.hhValue || data.HH || null,
                hValue: data.hValue || data.H || null,
                lValue: data.lValue || data.L || null,
                llValue: data.llValue || data.LL || null,
                
                // 量程
                minRange: null,
                maxRange: null,
                
                // 其他参数
                alarmCount: data.alarmCount || 0,
                status: data.status || '正常',
                updateTime: new Date().toLocaleString('zh-CN')
            };
        } else {
            // 如果设备已存在，只更新实时值和相关参数，保留从数据库获取的信息
            deviceData[deviceName].value = data.value || deviceData[deviceName].value;
            deviceData[deviceName].type = data.type || deviceData[deviceName].type;
            deviceData[deviceName].quality = data.quality || deviceData[deviceName].quality;
            deviceData[deviceName].timestamp = data.timestamp || deviceData[deviceName].timestamp;
            // 不要覆盖从数据库获取的描述和报警阈值
            // 只在数据库信息不存在时使用MQTT数据
            deviceData[deviceName].desc = deviceData[deviceName].desc || data.desc || '';
            deviceData[deviceName].hhValue = deviceData[deviceName].hhValue || data.hhValue || data.HH || null;
            deviceData[deviceName].hValue = deviceData[deviceName].hValue || data.hValue || data.H || null;
            deviceData[deviceName].lValue = deviceData[deviceName].lValue || data.lValue || data.L || null;
            deviceData[deviceName].llValue = deviceData[deviceName].llValue || data.llValue || data.LL || null;
            deviceData[deviceName].updateTime = new Date().toLocaleString('zh-CN');
        }
        
        // 检查设备实时值是否在报警范围内
        const deviceValue = parseFloat(data.value) || 0;
        const hValue = parseFloat(deviceData[deviceName].hValue || data.hValue || data.H) || Infinity;
        const lValue = parseFloat(deviceData[deviceName].lValue || data.lValue || data.L) || -Infinity;
        
        // 检查值是否在正常范围内（低于高限，高于低限）
        const isInNormalRange = deviceValue < hValue && deviceValue > lValue;
        
        // 查找该设备的未处理或已确认的报警
        const deviceAlarms = alarmData.filter(alarm => 
            alarm.deviceName === deviceName && 
            (alarm.status === '未处理' || alarm.status === '已确认')
        );
        
        // 仅当有明确的报警取消消息时才取消报警
        // 移除基于实时值的自动取消逻辑，避免误取消
        if (deviceAlarms.length === 0 && !isInNormalRange) {
            // 没有报警且值不在正常范围内，创建新报警
            const alarmItem = {
                time: new Date().toLocaleString('zh-CN'),
                deviceName: deviceName,
                type: deviceValue > hValue ? '高值报警' : '低值报警',
                value: deviceValue,
                limit: deviceValue > hValue ? hValue : lValue,
                status: '未处理',
                desc: deviceData[deviceName].desc || data.desc || ''
            };
            alarmData.unshift(alarmItem);
            if (alarmData.length > 50) {
                alarmData = alarmData.slice(0, 50);
            }
            
            // 更新报警表格
            updateAlarmDataTable();
        }
        
        debouncedUpdateDeviceDataTable();
        updateHistoryDeviceSelect();
        updateOverviewStats();
        
        // 检查是否需要更新保存设备清单到本地存储
        const now = Date.now();
        if (now - lastExportTime > EXPORT_INTERVAL) {
            console.log('设备数据更新，检查是否需要重新保存设备清单');
            // 检查是否有新设备添加
            const deviceCount = Object.keys(deviceData).length;
            console.log('当前设备数量:', deviceCount);
            
            // 如果设备数量大于0，且距离上次保存超过1分钟，则重新保存
            if (deviceCount > 0) {
                console.log('距离上次保存已超过1分钟，重新保存设备清单到本地存储');
                saveDeviceListToLocalStorage();
                lastExportTime = now;
            }
        }
    }
}

// 防抖函数，用于优化频繁的DOM更新
function debounce(func, wait) {
    let timeout;
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// 防抖处理的设备数据表格更新函数
const debouncedUpdateDeviceDataTable = debounce(updateDeviceDataTable, 100);

// 更新设备数据表格
function updateDeviceDataTable() {
    try {
        const tableBody = document.getElementById('device-data-table');
        if (!tableBody) return;
        
        const fragment = document.createDocumentFragment();
        
        Object.keys(deviceData).forEach(deviceName => {
            const device = deviceData[deviceName];
            const row = document.createElement('tr');
            
            // 检查值是否为数字，不是数字则显示为"--"
            const displayValue = isNaN(device.value) ? '--' : device.value;
            
            row.innerHTML = `
                <td class="px-3 py-2 text-center">${deviceName}</td>
                <td class="px-3 py-2">${device.desc || '--'}</td>
                <td class="px-3 py-2 text-center font-medium">${displayValue}</td>
                <td class="px-3 py-2 text-center">${device.minRange !== null && device.maxRange !== null ? `${device.minRange}-${device.maxRange}` : '--'}</td>
                <td class="px-3 py-2 text-center">${device.hhValue !== null ? device.hhValue : '--'}</td>
                <td class="px-3 py-2 text-center">${device.hValue !== null ? device.hValue : '--'}</td>
                <td class="px-3 py-2 text-center">${device.lValue !== null ? device.lValue : '--'}</td>
                <td class="px-3 py-2 text-center">${device.llValue !== null ? device.llValue : '--'}</td>
                <td class="px-3 py-2 text-center">--</td>
                <td class="px-3 py-2 text-center">--</td>
                <td class="px-3 py-2 text-center">--</td>
            `;
            
            fragment.appendChild(row);
        });
        
        // 清空表格并添加新行
        tableBody.innerHTML = '';
        tableBody.appendChild(fragment);
        
        // 更新设备数量显示
        const totalDevicesElement = document.getElementById('total-devices');
        const onlineDevicesElement = document.getElementById('online-devices');
        if (totalDevicesElement) {
            totalDevicesElement.textContent = Object.keys(deviceData).length;
        }
        if (onlineDevicesElement) {
            onlineDevicesElement.textContent = Object.keys(deviceData).length;
        }
        
    } catch (error) {
        console.error('更新设备数据表格时出错:', error);
    }
}

// 保存设备清单到本地存储
function saveDeviceListToLocalStorage() {
    try {
        const deviceList = Object.keys(deviceData);
        localStorage.setItem('deviceList', JSON.stringify(deviceList));
        console.log('设备清单已保存到本地存储，共', deviceList.length, '个设备');
    } catch (error) {
        console.error('保存设备清单到本地存储失败:', error);
    }
}

// 从后端获取设备信息
async function fetchDevicesFromBackend() {
    try {
        console.log('从后端获取设备信息...');
        const response = await fetch('http://localhost:3001/api/devices');
        if (!response.ok) {
            throw new Error('HTTP error ' + response.status);
        }
        const devices = await response.json();
        console.log('从后端获取设备信息成功，共', devices.data ? devices.data.length : 0, '个设备');
        
        // 处理获取到的设备信息
        if (devices.success && devices.data) {
            devices.data.forEach(device => {
                if (device.name) {
                    if (!deviceData[device.name]) {
                        deviceData[device.name] = {
                            value: 0,
                            desc: device.desc || '',
                            unit: device.unit || '',
                            minRange: device.minRange || null,
                            maxRange: device.maxRange || null,
                            hhValue: device.hhValue || null,
                            hValue: device.hValue || null,
                            lValue: device.lValue || null,
                            llValue: device.llValue || null,
                            type: device.type || null,
                            quality: device.quality || null,
                            timestamp: device.timestamp || null,
                            alarmCount: device.alarmCount || 0,
                            status: device.status || '正常',
                            updateTime: new Date().toLocaleString('zh-CN')
                        };
                    } else {
                        // 更新现有设备信息
                        deviceData[device.name].desc = device.desc || deviceData[device.name].desc;
                        deviceData[device.name].unit = device.unit || deviceData[device.name].unit;
                        deviceData[device.name].minRange = device.minRange || deviceData[device.name].minRange;
                        deviceData[device.name].maxRange = device.maxRange || deviceData[device.name].maxRange;
                        deviceData[device.name].hhValue = device.hhValue || deviceData[device.name].hhValue;
                        deviceData[device.name].hValue = device.hValue || deviceData[device.name].hValue;
                        deviceData[device.name].lValue = device.lValue || deviceData[device.name].lValue;
                        deviceData[device.name].llValue = device.llValue || deviceData[device.name].llValue;
                        deviceData[device.name].type = device.type || deviceData[device.name].type;
                    }
                }
            });
        }
        
        // 更新设备数据表格
        updateDeviceDataTable();
        // 更新历史数据设备选择
        updateHistoryDeviceSelect();
        // 更新综合概况统计数据
        updateOverviewStats();
        
        console.log('设备信息处理完成');
    } catch (error) {
        console.error('从后端获取设备信息失败:', error);
        // 如果从后端获取失败，尝试从本地存储获取
        loadDeviceListFromLocalStorage();
    }
}

// 从本地存储加载设备清单
function loadDeviceListFromLocalStorage() {
    try {
        const savedDeviceList = localStorage.getItem('deviceList');
        if (savedDeviceList) {
            const deviceList = JSON.parse(savedDeviceList);
            console.log('从本地存储加载设备清单，共', deviceList.length, '个设备');
            
            // 为每个设备创建默认数据
            deviceList.forEach(deviceName => {
                if (!deviceData[deviceName]) {
                    deviceData[deviceName] = {
                        value: 0,
                        desc: '',
                        unit: '',
                        minRange: null,
                        maxRange: null,
                        hhValue: null,
                        hValue: null,
                        lValue: null,
                        llValue: null,
                        type: null,
                        quality: null,
                        timestamp: null,
                        alarmCount: 0,
                        status: '正常',
                        updateTime: new Date().toLocaleString('zh-CN')
                    };
                }
            });
            
            // 更新设备数据表格
            updateDeviceDataTable();
            // 更新历史数据设备选择
            updateHistoryDeviceSelect();
            // 更新综合概况统计数据
            updateOverviewStats();
        }
    } catch (error) {
        console.error('从本地存储加载设备清单失败:', error);
    }
}

// 导出设备清单
function exportDeviceList() {
    try {
        const devices = Object.keys(deviceData).map(deviceName => {
            const device = deviceData[deviceName];
            return {
                位号: deviceName,
                描述: device.desc || '',
                实时数据: device.value,
                量程: device.minRange !== null && device.maxRange !== null ? `${device.minRange}-${device.maxRange}` : '--',
                高高限: device.hhValue || '--',
                高限: device.hValue || '--',
                低限: device.lValue || '--',
                低低限: device.llValue || '--',
                更新时间: device.updateTime
            };
        });
        
        const csvContent = convertToCSV(devices);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', '设备清单_' + new Date().toISOString().slice(0, 10) + '.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        console.log('设备清单导出成功');
    } catch (error) {
        console.error('导出设备清单失败:', error);
        alert('导出设备清单失败，请重试');
    }
}

// 将对象数组转换为CSV格式
function convertToCSV(objArray) {
    const array = typeof objArray !== 'object' ? JSON.parse(objArray) : objArray;
    let str = '';
    let line = '';
    
    // 添加表头
    for (let index in array[0]) {
        if (line !== '') line += ',';
        line += index;
    }
    str += line + '\r\n';
    
    // 添加数据行
    for (let i = 0; i < array.length; i++) {
        let line = '';
        for (let index in array[i]) {
            if (line !== '') line += ',';
            line += '"' + array[i][index] + '"';
        }
        str += line + '\r\n';
    }
    
    return str;
}

// 更新历史数据设备选择
function updateHistoryDeviceSelect() {
    // 这里可以添加更新历史数据设备选择的逻辑
    // 例如更新历史数据查询页面的设备选择下拉框
}

// 更新综合概况页面统计数据
function updateOverviewStats() {
    // 更新设备总数
    const totalDevices = Object.keys(deviceData).length;
    document.getElementById('total-devices-overview').textContent = totalDevices;
    document.getElementById('total-devices').textContent = totalDevices;
    
    // 简单计算在线设备数（这里假设所有设备都是在线的，实际应用中需要根据设备状态判断）
    const onlineDevices = totalDevices;
    document.getElementById('online-devices-overview').textContent = onlineDevices;
    document.getElementById('online-devices').textContent = onlineDevices;
    
    // 计算全厂自控率（这里使用模拟值，基于设备总数和报警数量计算）
    let autoControlRate = 0;
    if (totalDevices > 0) {
        // 基础全厂自控率为90%，每增加一个报警减少2%
        autoControlRate = Math.max(0, 90 - alarmData.length * 2);
    }
    document.getElementById('auto-control-rate').textContent = autoControlRate.toFixed(1) + '%';
    
    // 更新报警数量
    const alarmCount = alarmData.length;
    document.getElementById('alarm-count-overview').textContent = alarmCount;
    document.getElementById('alarm-count').textContent = alarmCount;
    document.getElementById('total-alarms').textContent = alarmCount;
}
