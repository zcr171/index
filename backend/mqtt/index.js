const mqtt = require('mqtt');
const { MQTT_CONFIG } = require('../config');
const { userDeviceCache, userMqttClients } = require('../cache');
const { sendToUser } = require('../utils');



// 初始化用户MQTT客户端
function initMQTTClient(userId, topics) {
  if (userMqttClients.has(userId)) {
    console.log(`用户 ${userId} 已有MQTT客户端，无需重复初始化`);
    return userMqttClients.get(userId);
  }

  const clientId = `${MQTT_CONFIG.clientIdPrefix}${userId}-${Date.now()}`;
  
  const client = mqtt.connect({
    host: MQTT_CONFIG.host,
    port: MQTT_CONFIG.port,
    username: MQTT_CONFIG.username,
    password: MQTT_CONFIG.password,
    clientId: clientId,
    connectTimeout: MQTT_CONFIG.connectTimeout,
    reconnectPeriod: MQTT_CONFIG.reconnectPeriod
  });

  // 连接成功
  client.on('connect', () => {
    console.log(`用户 ${userId} MQTT客户端连接成功，客户端ID: ${clientId}`);
    // 订阅所有主题
    topics.forEach(topic => {
      client.subscribe(topic, (err) => {
        if (err) {
          console.error(`订阅主题 ${topic} 失败:`, err);
        } else {
          console.log(`用户 ${userId} 成功订阅主题: ${topic}`);
        }
      });
    });
  });

  // 收到消息
  client.on('message', (topic, message) => {
    try {
      const parsedMessage = JSON.parse(message.toString());
      console.log(`收到MQTT消息原始结构:`, parsedMessage);
      console.log(`收到MQTT消息: ${topic} 包含 ${parsedMessage.RTValue ? parsedMessage.RTValue.length : 0} 个设备数据`);

      if (parsedMessage.RTValue && Array.isArray(parsedMessage.RTValue)) {
        const deviceSet = userDeviceCache.get(userId);
        const authorizedDevices = [];
        
        parsedMessage.RTValue.forEach(device => {
          const deviceNo = device.name;
          if (deviceSet && deviceSet.has(deviceNo)) {
            console.log('设备有权限，处理数据:', deviceNo, 'value:', device.value);
            authorizedDevices.push(device);
          } else {
            console.log('设备无权限，丢弃数据:', deviceNo);
          }
        });

        // 只发送有权限的设备数据
        if (authorizedDevices.length > 0) {
          sendToUser(userId, {
            type: 'realtime_data',
            data: {
              RTValue: authorizedDevices
            }
          });
          console.log(`发送实时数据给用户: ${userId} 设备数量: ${authorizedDevices.length}`);
        }
      }
    } catch (error) {
      console.error('解析MQTT消息失败:', error);
    }
  });

  // 错误处理
  client.on('error', (error) => {
    console.error(`用户 ${userId} MQTT客户端错误:`, error);
  });

  // 断开连接
  client.on('close', () => {
    console.log(`用户 ${userId} MQTT客户端断开连接`);
  });

  userMqttClients.set(userId, client);
  return client;
}

// 关闭用户MQTT客户端
function closeMQTTClient(userId) {
  if (userMqttClients.has(userId)) {
    const client = userMqttClients.get(userId);
    client.end();
    userMqttClients.delete(userId);
    console.log(`用户 ${userId} MQTT客户端已关闭`);
  }
}

module.exports = {
  initMQTTClient,
  closeMQTTClient
};
