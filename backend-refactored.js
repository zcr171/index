const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
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
const connectedClients = new Map();

// 内存缓存：用户ID → 设备位号Set
const userDeviceCache = new Map();

// 内存缓存：用户ID → MQTT客户端
const userMqttClients = new Map();

// 内存缓存：用户ID → 用户信息（用于缓存刷新）
const userInfoCache = new Map();

// 全局变量存储报警数据
let alarmData = { alarms: [] };

// 加载环境变量
dotenv.config();

const port = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 厂区配置：位掩码映射
const FACTORY_CONFIG = {
  RD: { bit: 1, value: 2, topic: 'rdvalue' },      // 热电域
  QH: { bit: 2, value: 4, topic: 'qhvalue' },      // 气化域
  JH: { bit: 3, value: 8, topic: 'jhvalue' },      // 净化成品域
  HS: { bit: 4, value: 16, topic: 'hsvalue' },     // 回收域
  DW: { bit: 5, value: 32, topic: 'dwvalue' }      // 人员定位系统
};

// 超级管理员标识
const SUPER_ADMIN = 99;

// 处理WebSocket连接
wss.on('connection', (ws, req) => {
  console.log('新的WebSocket客户端连接');
  
  // 从查询参数获取用户ID
  let userId = null;
  try {
    const queryString = req.url.split('?')[1];
    if (queryString) {
      const urlParams = new URLSearchParams(queryString);
      userId = urlParams.get('userId');
    }
  } catch (error) {
    console.error('解析WebSocket查询参数失败:', error);
  }
  
  if (userId) {
    connectedClients.set(userId, ws);
    console.log(`用户 ${userId} WebSocket连接成功`);
  }
  
  // 发送连接成功消息
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'WebSocket连接成功'
  }));
  
  // 处理客户端断开连接
  ws.on('close', () => {
    console.log('WebSocket客户端断开连接');
    if (userId) {
      connectedClients.delete(userId);
    }
  });
  
  // 处理客户端错误
  ws.on('error', (error) => {
    console.error('WebSocket客户端错误:', error);
    if (userId) {
      connectedClients.delete(userId);
    }
  });
});

// 向指定用户发送WebSocket消息
function sendToUser(userId, message) {
  const client = connectedClients.get(userId);
  if (client && client.readyState === WebSocket.OPEN) {
    try {
      client.send(JSON.stringify(message));
    } catch (error) {
      console.error('发送WebSocket消息失败:', error);
    }
  }
}

// 数据库连接配置
const dbConfig = {
  host: process.env.DB_HOST || '192.168.10.180',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'admin123',
  database: process.env.DB_NAME || 'scada_web',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// 创建数据库连接池
let pool;
try {
  pool = mysql.createPool(dbConfig);
  console.log('数据库连接池创建成功');
} catch (error) {
  console.error('数据库连接池创建失败:', error);
  process.exit(1);
}

// 测试数据库连接
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('数据库连接成功');
    return true;
  } catch (error) {
    console.error('数据库连接失败:', error.message);
    return false;
  }
}

// 【核心】二进制位掩码解析函数（严格按照用户规范）
function parseFactoryLevel(factoryLevel) {
  const areaMap = {
    RD: 2,
    QH: 4,
    JH: 8,
    HS: 16,
    DW: 32
  };
  const allowedAreas = [];
  // 仅对非99的数值做&运算
  if (factoryLevel !== SUPER_ADMIN) {
    for (const [areaName, bitValue] of Object.entries(areaMap)) {
      // 二进制&运算：只有结果≠0，说明有该厂区权限
      if ((factoryLevel & bitValue) !== 0) {
        allowedAreas.push(bitValue);
      }
    }
  } else {
    // 超级管理员返回所有厂区
    allowedAreas.push(...Object.values(areaMap));
  }
  return allowedAreas;
}

// 【核心】厂区列表 → MQTT Topic列表映射函数
function factoriesToTopics(factories) {
  if (factories.length === 0) {
    // 空工厂列表，返回所有Topic
    return Object.values(FACTORY_CONFIG).map(config => config.topic);
  }
  
  const topics = [];
  for (const factoryValue of factories) {
    // 查找对应的厂区配置
    for (const [areaName, config] of Object.entries(FACTORY_CONFIG)) {
      if (config.value === factoryValue) {
        topics.push(config.topic);
        break;
      }
    }
  }
  return topics;
}

// 【核心】批量查询用户有权限的设备（严格按照用户规范）
async function getUserDevices(userId, factories, areaLevel, isSuperAdmin) {
  try {
    let devices = [];
    let query = '';
    let params = [];
    
    if (isSuperAdmin) {
      // 超级管理员：无过滤，查所有设备
      console.log('超级管理员查询所有设备');
      query = `SELECT * FROM device_data`;
    } else {
      // 普通用户：带字段归属、权限过滤
      console.log('普通用户查询设备，厂区列表:', factories, 'areaLevel:', areaLevel);
      
      if (factories.length === 0) {
        console.log('用户无厂区权限，返回空设备列表');
        return {
          deviceSet: new Set(),
          deviceList: []
        };
      }
      
      // 构建厂区条件
      const factoryPlaceholders = factories.map(() => '?').join(',');
      query = `SELECT * FROM device_data 
               WHERE factory IN (${factoryPlaceholders}) 
               AND (level IS NULL OR level <= ?)`;
      
      // 构建查询参数
      params = [...factories, areaLevel];
    }
    
    // 执行查询
    const [results] = await pool.execute(query, params);
    devices = results;
    
    console.log('设备查询结果数量:', devices.length);
    
    // 构建设备位号Set（用于O(1)权限判断）
    const deviceSet = new Set();
    const deviceList = [];
    
    for (const device of devices) {
      deviceSet.add(device.device_no);
      deviceList.push(device); // 返回完整设备信息
    }
    
    // 缓存到内存（Key=用户ID，Value=设备位号Set）
    userDeviceCache.set(userId, deviceSet);
    console.log('设备缓存已更新，设备数量:', deviceSet.size);
    
    return {
      deviceSet,
      deviceList
    };
  } catch (error) {
    console.error('批量查询设备失败:', error);
    throw error;
  }
}

// 【核心】MQTT初始化函数
function initMQTTClient(userId, topics) {
  console.log('初始化MQTT客户端:', { userId, topics });
  
  // 尝试连接MQTT服务器（支持主备切换）
  function connectToMQTTServer(config, isBackup = false) {
    console.log(`${isBackup ? '尝试连接到备用MQTT服务器' : '尝试连接到MQTT服务器'}:`, config.host);
    let mqttClient;
    try {
      mqttClient = mqtt.connect(config);
    } catch (error) {
      console.error(`${isBackup ? '备用MQTT连接失败' : 'MQTT连接失败'}:`, error);
      return null;
    }

    mqttClient.on('connect', function(connack) {
      console.log(`${isBackup ? '备用MQTT连接成功' : 'MQTT连接成功'}:`, connack);

      // 订阅Topic列表（仅订阅有权限的纯Topic，无通配符）
      console.log('订阅MQTT Topic:', topics);
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
        console.log('收到MQTT消息:', topic, '包含', parsedMessage.RTValue ? parsedMessage.RTValue.length : 0, '个设备数据');
        
        // 检查消息格式是否正确
        if (parsedMessage.RTValue && Array.isArray(parsedMessage.RTValue)) {
          // 【核心】权限判断：对每个设备单独检查权限
          const deviceSet = userDeviceCache.get(userId);
          const authorizedDevices = [];
          
          parsedMessage.RTValue.forEach(device => {
            const deviceNo = device.name; // MQTT消息中的设备标识符字段是name
            if (deviceSet && deviceSet.has(deviceNo)) {
              console.log('设备有权限，处理数据:', deviceNo);
              authorizedDevices.push(device);
            } else {
              console.log('设备无权限，丢弃数据:', deviceNo);
              // 无权限的设备位号数据，直接丢弃
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
            console.log('发送实时数据给用户:', userId, '设备数量:', authorizedDevices.length);
          }
        } else {
          console.error('MQTT消息格式错误，缺少RTValue数组:', parsedMessage);
        }
      } catch (e) {
        console.error('解析MQTT消息失败:', e);
      }
    });

    mqttClient.on('error', function(err) {
      console.error('MQTT连接错误:', err);
      // 错误处理：MQTT连接错误不应导致服务器崩溃
    });

    mqttClient.on('offline', function() {
      console.log('MQTT连接断开');
    });

    mqttClient.on('close', function() {
      console.log('MQTT连接关闭');
    });

    return mqttClient;
  }

  // 主MQTT服务器配置
  const primaryConfig = {
    host: process.env.MQTT_HOST || '192.168.10.180',
    port: process.env.MQTT_PORT || 1883,
    username: process.env.MQTT_USERNAME || 'web_admin_9',
    password: process.env.MQTT_PASSWORD || 'web_admin_9',
    clientId: `user_${userId}_${Date.now()}`,
    clean: true,
    connectTimeout: 5000, // 缩短超时时间
    reconnectPeriod: 3000,
    keepalive: 30,
    resubscribe: true
  };

  // 备用MQTT服务器配置
  const backupConfig = {
    host: process.env.MQTT_BACKUP_HOST || '192.168.10.234',
    port: process.env.MQTT_BACKUP_PORT || 1883,
    username: process.env.MQTT_BACKUP_USERNAME || 'web_admin_9',
    password: process.env.MQTT_BACKUP_PASSWORD || 'web_admin_9',
    clientId: `user_${userId}_${Date.now()}_backup`,
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 3000,
    keepalive: 30,
    resubscribe: true
  };

  try {
    // 先尝试连接主服务器
    let mqttClient = connectToMQTTServer(primaryConfig);
    
    // 如果主服务器连接失败，尝试备用服务器
    if (!mqttClient) {
      console.log('主MQTT服务器连接失败，尝试备用服务器');
      mqttClient = connectToMQTTServer(backupConfig, true);
    }

    // 存储用户MQTT客户端
    if (mqttClient) {
      userMqttClients.set(userId, mqttClient);
    } else {
      console.warn('所有MQTT服务器连接失败，将在后台继续尝试重连');
    }
    
    return mqttClient;
  } catch (error) {
    console.error('MQTT客户端初始化失败:', error);
    return null;
  }
}

// JWT验证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ code: 401, msg: '未提供认证令牌' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key', (err, user) => {
    if (err) {
      return res.status(403).json({ code: 403, msg: '认证令牌无效' });
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
  const dbConnected = await testConnection();

  res.json({ 
    status: 'ok', 
    database: dbConnected ? 'main' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// 登录接口 - 支持 /api/login 路径
app.post('/api/login', async (req, res) => {
  await handleLogin(req, res);
});

// 登录接口 - 支持 /api/auth/login 路径（兼容前端）
app.post('/api/auth/login', async (req, res) => {
  await handleLogin(req, res);
});

// 登录处理函数
async function handleLogin(req, res) {
  try {
    const { username, password } = req.body;
    console.log('登录请求:', { username });
    
    // 验证参数
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
    }
    
    // 从数据库查询用户
    const [userResults] = await pool.execute(
      'SELECT id, username, password, realname, factory_level, area_level, enabled FROM web_user WHERE username = ?',
      [username]
    );
    
    if (userResults.length === 0) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    
    const user = userResults[0];
    
    // 检查账号是否启用
    if (user.enabled !== 1) {
      return res.status(403).json({ success: false, message: '账号已被禁用' });
    }
    
    // 验证密码
    let passwordMatch;
    console.log('开始验证密码:', { username, providedPassword: password, storedPassword: user.password });
    
    try {
      // 尝试使用bcrypt验证（适用于加密密码）
      console.log('尝试bcrypt验证');
      passwordMatch = await bcrypt.compare(password, user.password);
      console.log('bcrypt验证结果:', passwordMatch);
      
      // 如果bcrypt验证失败，尝试直接字符串比较（适用于明文密码）
      if (!passwordMatch) {
        console.log('bcrypt验证失败，尝试明文密码比较');
        passwordMatch = (password === user.password);
        console.log('明文密码比较结果:', passwordMatch);
      }
    } catch (error) {
      // 如果bcrypt验证抛出异常，尝试直接字符串比较（适用于明文密码）
      console.log('bcrypt验证抛出异常，尝试明文密码比较:', error.message);
      passwordMatch = (password === user.password);
      console.log('明文密码比较结果:', passwordMatch);
    }
    
    // 额外的调试信息
    console.log('密码长度比较:', { providedLength: password.length, storedLength: user.password.length });
    console.log('密码严格相等:', password === user.password);
    
    if (!passwordMatch) {
      console.log('密码验证失败:', { username, passwordMatch });
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    console.log('密码验证成功:', { username });

    
    // 【核心】位掩码解析厂区列表
    const factories = parseFactoryLevel(user.factory_level);
    console.log('用户权限解析:', { userId: user.id, factoryLevel: user.factory_level, factories });
    
    // 检查是否为超级管理员
    const isSuperAdmin = user.factory_level === SUPER_ADMIN;
    console.log('用户类型:', isSuperAdmin ? '超级管理员' : '普通用户');
    
    // 【核心】批量查询用户有权限的设备
    const { deviceList } = await getUserDevices(user.id, factories, user.area_level, isSuperAdmin);
    console.log('用户设备权限:', { userId: user.id, deviceCount: deviceList.length });
    
    // 【核心】厂区列表 → MQTT Topic列表映射
    const mqttTopics = factoriesToTopics(factories);
    console.log('用户MQTT订阅:', { userId: user.id, topics: mqttTopics });
    
    // 【核心】初始化MQTT客户端
    initMQTTClient(user.id, mqttTopics);
    console.log('MQTT客户端初始化完成');

    
    // 缓存用户信息（用于后续缓存刷新）
    userInfoCache.set(user.id, {
      factory_level: user.factory_level,
      area_level: user.area_level
    });
    
    // 生成JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.area_level === SUPER_ADMIN ? 'admin' : 'user'
      },
      process.env.JWT_SECRET || 'default_secret_key',
      {
        expiresIn: '24h'
      }
    );
    
    // 返回成功响应（兼容前端格式）
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        username: user.username,
        role: user.area_level === SUPER_ADMIN ? 'admin' : 'user'
      },
      data: {
        allowedDevices: deviceList
      }
    });
    
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ success: false, message: '登录失败，请稍后重试' });
  }
};

// 历史数据查询接口
app.get('/api/history', authenticateToken, async (req, res) => {
  try {
    const { userId, startTime, endTime } = req.query;
    console.log('历史数据查询请求:', { userId, startTime, endTime });
    
    // 验证参数
    if (!userId || !startTime || !endTime) {
      return res.status(400).json({ code: 400, msg: '参数不能为空' });
    }
    
    // 【核心】从内存缓存获取设备位号Set（禁止重复查询MySQL）
    const deviceSet = userDeviceCache.get(userId);
    if (!deviceSet) {
      return res.status(401).json({ code: 401, msg: '用户未登录或缓存已过期' });
    }
    
    const deviceNos = Array.from(deviceSet);
    if (deviceNos.length === 0) {
      return res.json({ code: 0, msg: 'success', data: [] });
    }
    
    // 构建设备位号IN条件
    const devicePlaceholders = deviceNos.map(() => '?').join(',');
    
    // 这里应该是查询历史数据的逻辑
    // 由于历史数据存储方式未知，这里仅返回示例结构
    // 实际实现时需要根据具体的历史数据存储方式调整
    
    res.json({
      code: 0,
      msg: 'success',
      data: {
        devices: deviceNos,
        startTime: startTime,
        endTime: endTime,
        message: '历史数据查询接口已实现，实际数据需要根据存储方式调整'
      }
    });
    
  } catch (error) {
    console.error('历史数据查询错误:', error);
    res.status(500).json({ code: 500, msg: '查询失败，请稍后重试' });
  }
});

// 退出登录接口
app.post('/api/logout', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    console.log('退出登录请求:', { userId });
    
    // 清理WebSocket连接
    connectedClients.delete(userId);
    
    // 清理MQTT客户端
    const mqttClient = userMqttClients.get(userId);
    if (mqttClient) {
      mqttClient.end();
      userMqttClients.delete(userId);
    }
    
    // 清理设备缓存
    userDeviceCache.delete(userId);
    // 清理用户信息缓存
    userInfoCache.delete(userId);
    
    res.json({ code: 0, msg: '退出成功' });
    
  } catch (error) {
    console.error('退出登录错误:', error);
    res.status(500).json({ code: 500, msg: '退出失败，请稍后重试' });
  }
});

// 获取设备列表接口
app.get('/api/devices', authenticateToken, async (req, res) => {
  try {
    console.log('获取设备列表请求');
    const { userId } = req.user;
    
    // 从用户信息缓存中获取用户权限信息
    const userInfo = userInfoCache.get(userId);
    if (!userInfo) {
      console.error('用户信息缓存不存在');
      return res.status(401).json({ success: false, message: '用户未登录或缓存已过期' });
    }
    
    // 解析用户厂区权限
    const factories = parseFactoryLevel(userInfo.factory_level);
    console.log('用户权限解析:', { userId, factoryLevel: userInfo.factory_level, factories });
    
    // 检查是否为超级管理员
    const isSuperAdmin = userInfo.factory_level === SUPER_ADMIN;
    console.log('用户类型:', isSuperAdmin ? '超级管理员' : '普通用户');
    
    // 批量查询用户有权限的设备
    const { deviceList } = await getUserDevices(userId, factories, userInfo.area_level, isSuperAdmin);
    console.log('用户设备权限:', { userId, deviceCount: deviceList.length });
    
    res.json({
      success: true,
      data: deviceList
    });
    
  } catch (error) {
    console.error('获取设备列表错误:', error);
    res.status(500).json({ success: false, message: '获取设备列表失败，请稍后重试' });
  }
});

// 刷新用户设备缓存
async function refreshUserDeviceCache(userId) {
  try {
    console.log('开始刷新用户设备缓存:', { userId });
    
    // 从用户信息缓存中获取用户权限信息
    const userInfo = userInfoCache.get(userId);
    if (!userInfo) {
      console.log('用户信息不存在，跳过缓存刷新:', { userId });
      return;
    }
    
    // 解析用户厂区权限
    const factories = parseFactoryLevel(userInfo.factory_level);
    console.log('用户权限解析:', { userId, factoryLevel: userInfo.factory_level, factories });
    
    // 检查是否为超级管理员
    const isSuperAdmin = userInfo.factory_level === SUPER_ADMIN;
    console.log('用户类型:', isSuperAdmin ? '超级管理员' : '普通用户');
    
    // 重新查询用户有权限的设备
    const { deviceSet } = await getUserDevices(userId, factories, userInfo.area_level, isSuperAdmin);
    console.log('缓存刷新完成，设备数量:', { userId, deviceCount: deviceSet.size });
    
  } catch (error) {
    console.error('刷新用户设备缓存失败:', error);
  }
}

// 刷新所有用户设备缓存
async function refreshAllDeviceCache() {
  try {
    console.log('开始刷新所有用户设备缓存，当前登录用户数:', userInfoCache.size);
    
    // 遍历所有已登录用户
    for (const userId of userInfoCache.keys()) {
      await refreshUserDeviceCache(userId);
    }
    
    console.log('所有用户设备缓存刷新完成');
  } catch (error) {
    console.error('刷新所有用户设备缓存失败:', error);
  }
}

// 启动服务器
server.listen(port, async () => {
  console.log('Server running on http://localhost:' + port);
  console.log('WebSocket server running on ws://localhost:' + port);
  
  try {
    // 测试数据库连接
    await testConnection();
    console.log('服务器启动成功，可以通过 http://localhost:' + port + ' 访问');
    
    // 设置定时刷新缓存（每5分钟刷新一次）
    console.log('设置设备缓存定时刷新，每5分钟执行一次');
    setInterval(refreshAllDeviceCache, 5 * 60 * 1000);
    
  } catch (error) {
    console.error('服务器启动时出错:', error);
  }
});

// 捕获未处理的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
  console.error('异常堆栈:', error.stack);
});

// 捕获未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
  if (reason && reason.stack) {
    console.error('拒绝原因堆栈:', reason.stack);
  }
});
