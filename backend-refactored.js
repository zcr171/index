const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const mqtt = require('mqtt');
const http = require('http');
const WebSocket = require('ws');

// 创建Express应用和HTTP服务器
const app = express();
const server = http.createServer(app);

// 创建WebSocket服务器
const wss = new WebSocket.Server({ server });

// 存储所有连接的WebSocket客户端
const connectedClients = new Set();

// 全局变量存储报警数据
let alarmData = { alarms: [] };

// 加载环境变量
dotenv.config();

const port = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 处理WebSocket连接
wss.on('connection', (ws) => {
  console.log('新的WebSocket客户端连接');
  // 将新客户端添加到集合中
  connectedClients.add(ws);
  
  // 发送连接成功消息
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'WebSocket连接成功'
  }));
  
  // 处理客户端断开连接
  ws.on('close', () => {
    console.log('WebSocket客户端断开连接');
    connectedClients.delete(ws);
  });
  
  // 处理客户端错误
  ws.on('error', (error) => {
    console.error('WebSocket客户端错误:', error);
    connectedClients.delete(ws);
  });
});

// 向所有连接的客户端广播消息
function broadcastMessage(message) {
  const messageString = JSON.stringify(message);
  connectedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageString);
      } catch (error) {
        console.error('发送WebSocket消息失败:', error);
        connectedClients.delete(client);
      }
    }
  });
}

// 数据库连接池配置
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const backupDbConfig = {
  host: process.env.DB_BACKUP_HOST,
  port: process.env.DB_BACKUP_PORT,
  user: process.env.DB_BACKUP_USER,
  password: process.env.DB_BACKUP_PASSWORD,
  database: process.env.DB_BACKUP_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// 创建数据库连接池
let mainPool = mysql.createPool(dbConfig);
let backupPool = mysql.createPool(backupDbConfig);
let currentPool = mainPool;
let isUsingBackup = false;

// 测试数据库连接
const testConnection = (pool, config) => {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, connection) => {
      if (err) {
        console.error(`数据库连接失败 [${config.host}]:`, err.message);
        resolve(false);
        return;
      }
      connection.ping((err) => {
        connection.release();
        if (err) {
          console.error(`数据库Ping失败 [${config.host}]:`, err.message);
          resolve(false);
          return;
        }
        console.log(`数据库连接成功 [${config.host}]`);
        resolve(true);
      });
    });
  });
};

// 检查数据库连接状态并切换
const checkAndSwitchConnection = async () => {
  console.log('检查数据库连接状态...');
  
  // 测试主库
  const mainConnected = await testConnection(mainPool, dbConfig);
  
  if (mainConnected) {
    if (isUsingBackup) {
      console.log('主库恢复，切换到主库');
      currentPool = mainPool;
      isUsingBackup = false;
    }
    return true;
  }
  
  // 测试备库
  const backupConnected = await testConnection(backupPool, backupDbConfig);
  
  if (backupConnected) {
    if (!isUsingBackup) {
      console.log('主库故障，切换到备库');
      currentPool = backupPool;
      isUsingBackup = true;
    }
    return true;
  }
  
  console.error('所有数据库连接失败');
  return false;
};

// 初始化MQTT连接
const initMQTTConnection = () => {
  // MQTT主服务器配置
  const mqttPrimaryConfig = {
    host: process.env.MQTT_HOST || '192.168.10.180',
    port: process.env.MQTT_PORT || 15675,
    username: process.env.MQTT_USERNAME || 'web_admin_9',
    password: process.env.MQTT_PASSWORD || 'web_admin_9',
    clientId: 'backend_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 3000,
    keepalive: 30,
    resubscribe: true,
    reconnectAttempts: 0
  };

  // 连接到MQTT服务器
  const brokerUrl = 'ws://' + mqttPrimaryConfig.host + ':' + mqttPrimaryConfig.port + '/ws';
  console.log('尝试连接到MQTT服务器:', brokerUrl);

  const mqttClient = mqtt.connect(brokerUrl, mqttPrimaryConfig);

  mqttClient.on('connect', function(connack) {
    console.log('MQTT连接成功:', connack);

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
  });

  mqttClient.on('message', function(topic, message) {
    try {
      const parsedMessage = JSON.parse(message.toString());
      
      if (topic === 'rtdvalue/report') {
        // 处理实时数据
        if (parsedMessage.RTValue && Array.isArray(parsedMessage.RTValue)) {
          console.log('收到实时数据，包含', parsedMessage.RTValue.length, '个设备，立即推送给前端');
          // 立即通过WebSocket推送给前端
          broadcastMessage({
            type: 'realtime_data',
            data: parsedMessage
          });
        } else if (parsedMessage.name) {
          console.log('收到单个设备实时数据:', parsedMessage.name, '，立即推送给前端');
          // 立即通过WebSocket推送给前端
          broadcastMessage({
            type: 'realtime_data',
            data: {
              RTValue: [parsedMessage]
            }
          });
        }
      } else if (topic === 'alarm/report' || topic === 'Raelalarm' || topic === 'realalarmtest') {
        // 处理报警数据
        if (parsedMessage.alarms && Array.isArray(parsedMessage.alarms)) {
          alarmData = parsedMessage;
          console.log('更新报警数据，包含', parsedMessage.alarms.length, '个报警');
          // 立即通过WebSocket推送给前端
          broadcastMessage({
            type: 'alarm_data',
            data: parsedMessage
          });
        } else {
          // 处理单个报警数据
          if (!alarmData.alarms) {
            alarmData.alarms = [];
          }
          // 只保留最新的报警数据，限制数量
          alarmData.alarms.unshift(parsedMessage);
          if (alarmData.alarms.length > 100) {
            alarmData.alarms = alarmData.alarms.slice(0, 100);
          }
          console.log('添加单个报警数据，立即推送给前端');
          // 立即通过WebSocket推送给前端
          broadcastMessage({
            type: 'alarm_data',
            data: {
              alarms: [parsedMessage]
            }
          });
        }
      } else if (topic === 'hisdatatest') {
        // 处理历史数据返回
        console.log('收到历史数据:', parsedMessage);
        // 这里可以添加历史数据处理逻辑
      }
    } catch (e) {
      console.error('解析MQTT消息失败:', e);
    }
  });

  mqttClient.on('error', function(err) {
    console.error('MQTT连接错误:', err);
  });

  mqttClient.on('offline', function() {
    console.log('MQTT连接断开');
  });

  return mqttClient;
};

// 初始化数据库连接
const initDatabaseConnection = async () => {
  await checkAndSwitchConnection();
  // 每30秒检查一次连接状态
  setInterval(checkAndSwitchConnection, 30000);
};

// 数据库查询函数
const queryDatabase = (sql, values) => {
  return new Promise((resolve, reject) => {
    currentPool.execute(sql, values, (err, results) => {
      if (err) {
        console.error('数据库查询失败:', err.message);
        // 立即检查连接状态
        checkAndSwitchConnection().then(() => {
          // 切换后重试一次
          currentPool.execute(sql, values, (retryErr, retryResults) => {
            if (retryErr) {
              reject(retryErr);
            } else {
              resolve(retryResults);
            }
          });
        });
        return;
      }
      resolve(results);
    });
  });
};



// JWT验证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: '未提供认证令牌' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key', (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: '认证令牌无效' });
    }

    req.user = user;
    next();
  });
};

// 根路径
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// 健康检查接口
app.get('/api/health', async (req, res) => {
  const dbConnected = await checkAndSwitchConnection();

  res.json({ 
    status: 'ok', 
    database: dbConnected ? (isUsingBackup ? 'backup' : 'main') : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// 登录接口
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log('登录请求:', { username, password: '******' });
    
    // 验证参数
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    
    // 从数据库查询用户
    const userResults = await queryDatabase(
      'SELECT * FROM web_user WHERE username = ?',
      [username]
    );
    
    if (userResults.length === 0) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    
    const user = userResults[0];
    
    // 验证密码
    const passwordMatch = await bcrypt.compare(password, user.password);
    
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    
    // 生成JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role || 'user'
      },
      process.env.JWT_SECRET || 'default_secret_key',
      {
        expiresIn: '24h'
      }
    );
    
    // 返回成功响应
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role || 'user'
      }
    });
    
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ success: false, message: '登录失败，请稍后重试' });
  }
});

// 获取设备列表接口
app.get('/api/devices', async (req, res) => {
  try {
    console.log('获取设备列表请求');
    
    // 从数据库获取所有设备信息
    const deviceResults = await queryDatabase(
      'SELECT DISTINCT device_no, description, unit, qty_min, qty_max, HH, H, L, LL, factory, level, is_major_hazard, is_sis FROM scada_web.device_data'
    );
    
    console.log('设备列表获取结果:', { length: deviceResults.length });
    
    // 格式化结果
    const devices = deviceResults.map(item => ({
      device_no: item.device_no,
      description: item.description || '',
      unit: item.unit || '',
      qty_min: item.qty_min !== undefined && item.qty_min !== null ? item.qty_min : null,
      qty_max: item.qty_max !== undefined && item.qty_max !== null ? item.qty_max : null,
      HH: item.HH !== undefined && item.HH !== null ? item.HH : null,
      H: item.H !== undefined && item.H !== null ? item.H : null,
      L: item.L !== undefined && item.L !== null ? item.L : null,
      LL: item.LL !== undefined && item.LL !== null ? item.LL : null,
      factory: item.factory || null,
      level: item.level || null,
      is_major_hazard: item.is_major_hazard || null,
      is_sis: item.is_sis || null
    }));
    
    res.json({
      success: true,
      data: devices
    });
    
  } catch (error) {
    console.error('获取设备列表错误:', error);
    res.status(500).json({ success: false, message: '获取设备列表失败，请稍后重试' });
  }
});

// 搜索设备接口
app.get('/api/devices/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    console.log('设备搜索请求:', { keyword });
    
    if (!keyword || keyword.trim() === '') {
      return res.json({ success: true, data: [] });
    }
    
    // 从数据库搜索设备
    const deviceResults = await queryDatabase(
      'SELECT DISTINCT device_no, description, unit, qty_min, qty_max, HH, H, L, LL, factory, level, is_major_hazard, is_sis FROM scada_web.device_data WHERE device_no LIKE ? LIMIT 50',
      ['%' + keyword + '%']
    );
    
    console.log('设备搜索结果:', { length: deviceResults.length });
    
    // 格式化结果
    const devices = deviceResults.map(item => ({
      device_no: item.device_no,
      description: item.description || '',
      unit: item.unit || '',
      qty_min: item.qty_min !== undefined && item.qty_min !== null ? item.qty_min : null,
      qty_max: item.qty_max !== undefined && item.qty_max !== null ? item.qty_max : null,
      HH: item.HH !== undefined && item.HH !== null ? item.HH : null,
      H: item.H !== undefined && item.H !== null ? item.H : null,
      L: item.L !== undefined && item.L !== null ? item.L : null,
      LL: item.LL !== undefined && item.LL !== null ? item.LL : null,
      factory: item.factory || null,
      level: item.level || null,
      is_major_hazard: item.is_major_hazard || null,
      is_sis: item.is_sis || null
    }));
    
    res.json({ success: true, data: devices });
    
  } catch (error) {
    console.error('设备搜索错误:', error);
    res.status(500).json({ success: false, message: '搜索失败，请稍后重试' });
  }
});

// 历史数据查询接口
app.post('/api/history/data', async (req, res) => {
  try {
    const { device_no, start_time, end_time, interval = 1000, count = 20 } = req.body;
    console.log('历史数据查询请求:', { device_no, start_time, end_time, interval, count });
    
    // 验证参数
    if (!device_no || (!Array.isArray(device_no) && !device_no.length)) {
      return res.status(400).json({ success: false, message: '设备列表不能为空' });
    }
    
    if (!start_time || !end_time) {
      return res.status(400).json({ success: false, message: '时间范围不能为空' });
    }
    
    // 构建查询消息
    const queryMessage = {
      method: 'HistoryData',
      topic: 'hisdatatest',
      names: Array.isArray(device_no) ? device_no : [device_no],
      seq: Date.now(),
      mode: 0,
      begintime: new Date(start_time).getTime(),
      endtime: new Date(end_time).getTime(),
      count: count,
      interval: interval,
      timeout: 20000
    };
    
    console.log('历史数据查询参数:', queryMessage);
    
    // 返回成功响应，前端将直接通过MQTT发送查询请求
    res.json({
      success: true,
      message: '历史数据查询参数已准备',
      data: {
        request_id: queryMessage.seq,
        devices: queryMessage.names,
        query_message: queryMessage
      }
    });
    
  } catch (error) {
    console.error('历史数据查询错误:', error);
    res.status(500).json({ success: false, message: '查询失败，请稍后重试' });
  }
});

// 历史报警查询接口
app.post('/api/history/alarm', async (req, res) => {
  try {
    const { device_no, start_time, end_time } = req.body;
    console.log('历史报警查询请求:', { device_no, start_time, end_time });
    
    // 验证参数
    if (!start_time || !end_time) {
      return res.status(400).json({ success: false, message: '时间范围不能为空' });
    }
    
    // 构建查询消息
    const queryMessage = {
      method: 'HistoryAlarm',
      topic: 'hisdatatest',
      names: device_no && Array.isArray(device_no) ? device_no : (device_no ? [device_no] : []),
      seq: Date.now(),
      mode: 0,
      begintime: new Date(start_time).getTime(),
      endtime: new Date(end_time).getTime(),
      timeout: 20000
    };
    
    console.log('历史报警查询参数:', queryMessage);
    
    // 返回成功响应
    res.json({
      success: true,
      message: '历史报警查询参数已准备',
      data: {
        request_id: queryMessage.seq,
        devices: queryMessage.names,
        query_message: queryMessage
      }
    });
    
  } catch (error) {
    console.error('历史报警查询错误:', error);
    res.status(500).json({ success: false, message: '查询失败，请稍后重试' });
  }
});

// 实时数据接口
app.get('/api/realtime/data', async (req, res) => {
  try {
    console.log('获取实时数据请求');
    
    // 由于现在使用WebSocket推送实时数据，此接口返回空数据并提示前端使用WebSocket
    res.json({
      success: true,
      message: '请使用WebSocket连接获取实时数据',
      data: {
        RTValue: []
      }
    });
    
  } catch (error) {
    console.error('获取实时数据错误:', error);
    res.status(500).json({ success: false, message: '获取实时数据失败，请稍后重试' });
  }
});

// 报警数据接口
app.get('/api/alarm/data', async (req, res) => {
  try {
    console.log('获取报警数据请求');
    
    // 返回存储的报警数据
    res.json({
      success: true,
      message: '报警数据获取成功',
      data: alarmData
    });
    
  } catch (error) {
    console.error('获取报警数据错误:', error);
    res.status(500).json({ success: false, message: '获取报警数据失败，请稍后重试' });
  }
});

// 启动服务器
server.listen(port, async () => {
  console.log('Server running on http://localhost:' + port);
  console.log('WebSocket server running on ws://localhost:' + port);
  try {
    // 初始化数据库连接
    await initDatabaseConnection();
    console.log('数据库连接初始化完成');
    
    // 初始化MQTT连接
    const mqttClient = initMQTTConnection();
    console.log('MQTT连接初始化完成');
    
    console.log('服务器启动成功，可以通过 http://localhost:' + port + ' 访问');
  } catch (error) {
    console.error('服务器启动时出错:', error);
  }
});

// 捕获未处理的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

// 捕获未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
});