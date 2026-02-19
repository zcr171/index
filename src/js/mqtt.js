// WebSocket连接实例
let ws = null;

// 连接到WebSocket服务器
function connectWebSocket() {
    console.log('连接到WebSocket服务器...');
    
    // 从localStorage获取用户信息
    const token = localStorage.getItem('token');
    let userId = null;
    
    // 尝试从token中解析userId
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            userId = payload.userId;
            console.log('从token中解析出userId:', userId);
        } catch (error) {
            console.error('解析token失败:', error);
        }
    }
    
    // 创建WebSocket连接，传递userId参数
    const wsUrl = userId ? `ws://localhost:3003?userId=${userId}` : 'ws://localhost:3003';
    console.log('WebSocket连接URL:', wsUrl);
    ws = new WebSocket(wsUrl);
    
    // 连接成功
    ws.onopen = function() {
        console.log('WebSocket连接成功');
        // 更新MQTT状态灯
        updateMQTTStatusLights();
    };
    
    // 接收消息
    ws.onmessage = function(event) {
        try {
            const message = JSON.parse(event.data);
            console.log('收到WebSocket消息:', message.type);
            
            // 处理实时数据
            if (message.type === 'realtime_data' && message.data) {
                if (message.data.RTValue && Array.isArray(message.data.RTValue)) {
                    console.log('收到实时数据，包含', message.data.RTValue.length, '个设备');
                    message.data.RTValue.forEach(deviceData => {
                        processRealTimeData(deviceData);
                    });
                }
            }
            // 处理报警数据
            else if (message.type === 'alarm_data' && message.data) {
                if (message.data.alarms && Array.isArray(message.data.alarms)) {
                    console.log('收到报警数据，包含', message.data.alarms.length, '个报警');
                    message.data.alarms.forEach(alarmData => {
                        processAlarmData(alarmData);
                    });
                }
            }
        } catch (error) {
            console.error('解析WebSocket消息失败:', error);
        }
    };
    
    // 连接关闭
    ws.onclose = function() {
        console.log('WebSocket连接关闭');
        // 更新MQTT状态灯
        updateMQTTStatusLights();
        // 尝试重新连接
        setTimeout(connectWebSocket, 3000);
    };
    
    // 连接错误
    ws.onerror = function(error) {
        console.error('WebSocket连接错误:', error);
        // 更新MQTT状态灯
        updateMQTTStatusLights();
    };
}

// 连接到后端服务（使用WebSocket）
function connectMQTT() {
    console.log('连接到后端服务...');
    // 连接WebSocket服务器
    connectWebSocket();
    
    console.log('后端服务连接成功，等待实时数据推送');
}

// 断开与后端服务的连接
function disconnectMQTT() {
    console.log('断开与后端服务的连接');
    // 关闭WebSocket连接
    if (ws) {
        ws.close();
        ws = null;
    }
}

// 检查MySQL数据库状态
function checkMySQLStatus() {
    fetch(`${API_BASE_URL}/health`)
        .then(response => {
            if (!response.ok) {
                throw new Error('HTTP error ' + response.status);
            }
            return response.json();
        })
        .then(result => {
            // 更新主库状态灯
            const primaryStatus = document.getElementById('mysql-primary-status');
            if (primaryStatus) {
                primaryStatus.className = 'status-indicator ' + (result.database === 'main' ? 'status-online' : 'status-offline');
            }
            
            // 更新备库状态灯
            const backupStatus = document.getElementById('mysql-backup-status');
            if (backupStatus) {
                backupStatus.className = 'status-indicator ' + (result.database === 'backup' ? 'status-online' : 'status-offline');
            }
            
            console.log('数据库状态更新:', {
                database: result.database,
                status: result.status
            });
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

// 更新MQTT状态灯
function updateMQTTStatusLights() {
    // 根据WebSocket连接状态更新MQTT状态灯
    const primaryStatus = document.getElementById('mqtt-primary-status');
    const backupStatus = document.getElementById('mqtt-backup-status');
    
    if (primaryStatus) {
        primaryStatus.className = 'status-indicator ' + (ws && ws.readyState === WebSocket.OPEN ? 'status-online' : 'status-offline');
    }
    
    if (backupStatus) {
        // 备用状态灯也使用相同的状态，因为我们只有一个WebSocket连接
        backupStatus.className = 'status-indicator ' + (ws && ws.readyState === WebSocket.OPEN ? 'status-online' : 'status-offline');
    }
    
    console.log('MQTT状态灯更新:', {
        connected: ws && ws.readyState === WebSocket.OPEN,
        readyState: ws ? ws.readyState : 'not initialized'
    });
}
