// 全局变量声明
let mqttClient = null;              // MQTT客户端实例
let isConnected = false;            // MQTT连接状态
let deviceData = {};                // 设备实时数据，键为设备名称
let alarmData = [];                 // 实时报警数据
let historyAlarmData = [];          // 历史报警数据
let historyData = [];               // 历史数据
let clientId = getClientId();       // 客户端ID

// 生成并存储唯一客户端ID
function getClientId() {
    let id = localStorage.getItem('clientId');
    if (!id) {
        id = 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('clientId', id);
    }
    return id;
}

// MQTT配置 - 主服务器（同MySQL主库）
const mqttPrimaryConfig = {
    host: '192.168.10.180',
    port: 15675,
    username: 'web_admin_9',
    password: 'web_admin_9',
    clientId: clientId // 使用与API相同的clientId
};

// MQTT配置 - 备用服务器（同MySQL备库）
const mqttBackupConfig = {
    host: '192.168.10.234',
    port: 15675,
    username: 'web_admin_9',
    password: 'web_admin_9',
    clientId: clientId // 使用与API相同的clientId
};

// 当前活动的MQTT配置
let mqttConfig = mqttPrimaryConfig;
let isMQTTPrimaryActive = true;

// MySQL配置
const mysqlConfig = {
    host: '192.168.10.179',
    port: 3306,
    database: 'webtest',
    username: 'webuser',
    password: 'webuser'
};
