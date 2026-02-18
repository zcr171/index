// MQTT连接状态监控间隔
let mqttStatusCheckInterval = null;

/**
 * 连接到MQTT服务器
 * 功能：建立与RabbitMQ服务器的MQTT连接，订阅相关主题
 * 实现：
 * 1. 构建MQTT服务器连接URL
 * 2. 创建MQTT客户端实例并连接
 * 3. 连接成功后更新连接状态和UI
 * 4. 停止模拟数据生成（如果正在运行）
 * 5. 订阅相关MQTT主题
 */
function connectMQTT() {
    // 清除之前的状态检查
    if (mqttStatusCheckInterval) {
        clearInterval(mqttStatusCheckInterval);
        mqttStatusCheckInterval = null;
    }
    
    // 尝试连接当前配置的MQTT服务器
    const brokerUrl = 'ws://' + mqttConfig.host + ':' + mqttConfig.port + '/ws';
    console.log('尝试连接到 MQTT 服务器:', brokerUrl);
    
    // 确保之前的客户端已断开
    if (mqttClient) {
        try {
            mqttClient.end(true);
        } catch (e) {
            console.error('关闭之前的MQTT客户端失败:', e);
        }
        mqttClient = null;
    }
    
    mqttClient = mqtt.connect(brokerUrl, {
        username: mqttConfig.username,
        password: mqttConfig.password,
        clientId: mqttConfig.clientId,
        clean: true,
        connectTimeout: 10000, // 连接超时增加到10秒
        reconnectPeriod: 3000, // 重连间隔减少到3秒，更快恢复连接
        keepalive: 30, // 心跳间隔减少到30秒，更频繁地检测连接状态
        resubscribe: true, // 重连后自动重新订阅主题
        reconnectAttempts: 0 // 无限重连尝试
    });
    mqttClient.on('connect', function(connack) {
        console.log('MQTT 连接成功:', connack);
        isConnected = true;
        
        // 更新状态灯
        updateMQTTStatusLights();
        
        // 连接成功后停止模拟数据
        if (simulationInterval) {
            clearInterval(simulationInterval);
            simulationInterval = null;
            console.log('已停止模拟数据生成');
        }
        
        // 保留现有数据，继续接收新数据
        console.log('准备接收实际数据，保留现有数据');
        
        // 更新设备数量显示
        document.getElementById('total-devices').textContent = Object.keys(deviceData).length;
        document.getElementById('online-devices').textContent = Object.keys(deviceData).length;
        document.getElementById('alarm-count').textContent = alarmData.length;
        document.getElementById('total-alarms').textContent = alarmData.length;
        document.getElementById('unprocessed-alarms').textContent = alarmData.filter(item => item.status === '未处理').length;
        document.getElementById('processed-alarms').textContent = alarmData.filter(item => item.status === '已处理').length;
        
        // 订阅主题
        const topics = [
            'rtdvalue/report',
            'alarm/report',
            'Raelalarm',
            'realalarmtest',
            'hisdatatest'
        ];
        
        topics.forEach(topic => {
            mqttClient.subscribe(topic, function(err) {
                if (!err) {
                    console.log('订阅主题成功:', topic);
                } else {
                    console.error('订阅主题失败:', topic, err);
                }
            });
        });
        
        // 订阅成功后，延迟2秒保存设备清单到本地存储（等待设备数据更新）
        setTimeout(function() {
            console.log('MQTT连接成功，开始保存设备清单到本地存储');
            saveDeviceListToLocalStorage(); // 保存到本地存储
            console.log('设备清单已保存到本地存储');
        }, 2000);
        
        // 启动连接状态监控
        startMQTTStatusCheck();
    });
    mqttClient.on('error', function(err) {
        console.error('MQTT 连接错误:', err);
        // 不要立即将状态设置为离线，因为客户端可能正在自动重连
        console.log('MQTT 客户端可能正在自动重连...');
        // 只在确认连接真正断开时才更新状态
        updateMQTTStatusLights();
        // 尝试切换到备用服务器
        switchMQTTServer();
    });
    
    mqttClient.on('close', function() {
        console.log('MQTT 连接关闭');
        isConnected = false;
        updateMQTTStatusLights();
    });
    mqttClient.on('message', function(topic, message) {
        // 避免在控制台打印过多日志，只打印关键信息
        if (topic === 'rtdvalue/report') {
            try {
                const parsedMessage = JSON.parse(message.toString());
                if (parsedMessage.RTValue && Array.isArray(parsedMessage.RTValue)) {
                    console.log('收到实时数据，包含', parsedMessage.RTValue.length, '个设备');
                } else {
                    console.log('收到单个设备实时数据');
                }
            } catch (e) {
                console.error('解析实时数据失败:', e);
            }
        }
        
        try {
            const parsedMessage = JSON.parse(message.toString());
            if (topic === 'rtdvalue/report') {
                // 检查消息格式是否包含RTValue数组
                if (parsedMessage.RTValue && Array.isArray(parsedMessage.RTValue)) {
                    // 处理RTValue数组中的每个设备数据
                    parsedMessage.RTValue.forEach(deviceData => {
                        processRealTimeData(deviceData);
                    });
                } else {
                    // 处理单个设备数据
                    processRealTimeData(parsedMessage);
                }
            } else if (topic === 'alarm/report') {
                processAlarmData(parsedMessage);
            } else if (topic === 'Raelalarm' || topic === 'realalarmtest') {
                // 处理实时报警消息
                if (parsedMessage.method === 'RealAlarm' && parsedMessage.alarms && Array.isArray(parsedMessage.alarms)) {
                    parsedMessage.alarms.forEach(alarmData => {
                        processAlarmData(alarmData);
                    });
                }
            } else if (topic === '5' || topic === 'hisdatatest') {
                // 处理历史数据返回
                if (parsedMessage.method === 'HistoryData' && parsedMessage.result && parsedMessage.result.data) {
                    processHistoryData(parsedMessage);
                }
            }
        } catch (e) {
            console.error('解析消息失败:', e);
        }
    });
    
    mqttClient.on('offline', function() {
        console.log('MQTT 连接断开');
        isConnected = false;
        updateMQTTStatusLights();
        
        // 实现故障切换
        console.log('开始MQTT服务器故障切换...');
        switchMQTTServer();
    });
    
    mqttClient.on('reconnect', function() {
        console.log('MQTT 正在重连...');
        updateMQTTStatusLights();
    });
    
    mqttClient.on('end', function() {
        console.log('MQTT 连接已结束');
        isConnected = false;
        updateMQTTStatusLights();
    });
}

// 启动MQTT连接状态监控
function startMQTTStatusCheck() {
    // 每30秒检查一次连接状态
    mqttStatusCheckInterval = setInterval(function() {
        if (mqttClient && !isConnected) {
            console.log('检测到MQTT连接已断开，尝试重新连接...');
            // 尝试重新连接
            try {
                connectMQTT();
            } catch (e) {
                console.error('重新连接MQTT失败:', e);
            }
        }
    }, 30000);
}

// 停止MQTT连接状态监控
function stopMQTTStatusCheck() {
    if (mqttStatusCheckInterval) {
        clearInterval(mqttStatusCheckInterval);
        mqttStatusCheckInterval = null;
    }
}

function disconnectMQTT() {
    // 停止状态监控
    stopMQTTStatusCheck();
    
    if (mqttClient) {
        mqttClient.end();
        mqttClient = null;
        isConnected = false;
        updateMQTTStatusLights();
        console.log('MQTT 连接已断开');
    }
}

// 更新MQTT状态灯
function updateMQTTStatusLights() {
    const primaryStatus = document.getElementById('mqtt-primary-status');
    const backupStatus = document.getElementById('mqtt-backup-status');
    
    if (primaryStatus) {
        primaryStatus.classList.remove('status-online', 'status-offline');
        primaryStatus.classList.add(isMQTTPrimaryActive && isConnected ? 'status-online' : 'status-offline');
    }
    
    if (backupStatus) {
        backupStatus.classList.remove('status-online', 'status-offline');
        backupStatus.classList.add(!isMQTTPrimaryActive && isConnected ? 'status-online' : 'status-offline');
    }
}

// 切换MQTT服务器
function switchMQTTServer() {
    console.log('开始切换MQTT服务器...');
    
    if (isMQTTPrimaryActive) {
        // 切换到备用服务器
        mqttConfig = mqttBackupConfig;
        isMQTTPrimaryActive = false;
        console.log('已切换到备用MQTT服务器:', mqttConfig.host);
    } else {
        // 切换回主服务器
        mqttConfig = mqttPrimaryConfig;
        isMQTTPrimaryActive = true;
        console.log('已切换回主MQTT服务器:', mqttConfig.host);
    }
    
    // 重新连接
    console.log('正在重新连接到MQTT服务器...');
    connectMQTT();
}

// 检查MySQL数据库状态
function checkMySQLStatus() {
    fetch('/api/database/status')
        .then(response => {
            if (!response.ok) {
                throw new Error('HTTP error ' + response.status);
            }
            return response.json();
        })
        .then(result => {
            if (result.success) {
                // 更新主库状态灯
                const primaryStatus = document.getElementById('mysql-primary-status');
                if (primaryStatus) {
                    primaryStatus.className = 'status-indicator ' + (result.primary.connected ? 'status-online' : 'status-offline');
                }
                
                // 更新备库状态灯
                const backupStatus = document.getElementById('mysql-backup-status');
                if (backupStatus) {
                    backupStatus.className = 'status-indicator ' + (result.backup.connected ? 'status-online' : 'status-offline');
                }
                
                console.log('数据库状态更新:', {
                    primary: result.primary,
                    backup: result.backup,
                    current: result.current
                });
            }
        })
        .catch(error => {
            console.error('数据库状态检查失败:', error);
            // 出错时设置为离线状态
            const primaryStatus = document.getElementById('mysql-primary-status');
            const backupStatus = document.getElementById('mysql-backup-status');
            if (primaryStatus) primaryStatus.className = 'status-indicator status-offline';
            if (backupStatus) backupStatus.className = 'status-indicator status-offline';
        });
}

// 启动MySQL状态检查
function startMySQLStatusCheck() {
    // 立即检查一次
    checkMySQLStatus();
    
    // 每10秒检查一次
    setInterval(checkMySQLStatus, 10000);
}
