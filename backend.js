const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config();

const app = express();
const port = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

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

// 根路径
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/industrial-visualization-system.html');
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

// 数据库状态检查接口
app.get('/api/database/status', async (req, res) => {
  try {
    console.log('检查数据库状态...');
    
    // 测试主库连接
    const mainConnected = await testConnection(mainPool, dbConfig);
    
    // 测试备库连接
    const backupConnected = await testConnection(backupPool, backupDbConfig);
    
    res.json({
      success: true,
      primary: {
        host: dbConfig.host,
        connected: mainConnected
      },
      backup: {
        host: backupDbConfig.host,
        connected: backupConnected
      },
      current: isUsingBackup ? 'backup' : 'main',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('数据库状态检查错误:', error);
    res.status(500).json({
      success: false,
      message: '数据库状态检查失败'
    });
  }
});

// 登录接口
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log('登录请求:', { username, password: '******' });
    console.log('请求体:', req.body);
    
    // 验证参数
    if (!username || !password) {
      console.log('参数验证失败: 用户名或密码为空');
      return res.status(400).json({
        success: false,
        message: '用户名和密码不能为空'
      });
    }
    
    // 从数据库查询用户
    console.log('开始查询数据库...');
    console.log('SQL: SELECT * FROM scada_web.web_user WHERE username = ?');
    console.log('参数:', [username]);
    
    const userResults = await queryDatabase(
      'SELECT * FROM scada_web.web_user WHERE username = ?',
      [username]
    );
    
    console.log('数据库查询结果:', { length: userResults.length, results: userResults });
    
    if (userResults.length === 0) {
      console.log('用户不存在:', username);
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }
    
    const user = userResults[0];
    console.log('找到用户:', { id: user.id, username: user.username, hasPassword: !!user.password });
    
    // 验证密码
    console.log('开始验证密码...');
    console.log('密码字段类型:', typeof user.password);
    console.log('密码字段长度:', user.password ? user.password.length : 0);
    
    const passwordMatch = await bcrypt.compare(password, user.password);
    console.log('密码验证结果:', passwordMatch);
    
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }
    
    // 生成JWT token
    console.log('登录成功，生成token...');
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
    console.log('返回成功响应:', { username: user.username, role: user.role || 'user' });
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role || 'user',
        // 可以添加其他用户信息
      }
    });
    
  } catch (error) {
    console.error('登录错误:', error);
    console.error('错误堆栈:', error.stack);
    res.status(500).json({
      success: false,
      message: '登录失败，请稍后重试'
    });
  }
});

// 搜索设备编号接口
app.get('/api/devices/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    console.log('设备搜索请求:', { keyword });
    
    if (!keyword || keyword.trim() === '') {
      return res.json({
        success: true,
        devices: []
      });
    }
    
    // 从数据库搜索设备编号
    const deviceResults = await queryDatabase(
      'SELECT DISTINCT device_no FROM scada_web.device_data WHERE device_no LIKE ? LIMIT 10',
      ['%' + keyword + '%']
    );
    
    console.log('设备搜索结果:', { length: deviceResults.length });
    
    // 格式化结果
    const devices = deviceResults.map(item => item.device_no);
    
    res.json({
      success: true,
      devices: devices
    });
    
  } catch (error) {
    console.error('设备搜索错误:', error);
    res.status(500).json({
      success: false,
      message: '搜索失败，请稍后重试'
    });
  }
});

// 获取所有设备信息接口
app.get('/api/devices', async (req, res) => {
  try {
    console.log('获取所有设备信息请求');
    
    // 从数据库获取所有设备信息
    const deviceResults = await queryDatabase(
      'SELECT DISTINCT device_no, unit, qty_min, qty_max, HH, H, L, LL, factory, is_major_hazard, is_sis FROM scada_web.device_data LIMIT 100'
    );
    
    console.log('设备列表获取结果:', { length: deviceResults.length });
    
    // 格式化结果
    const devices = deviceResults.map(item => ({
      name: item.device_no,
      desc: '',
      unit: item.unit || '',
      type: '',
      hhValue: item.HH !== undefined && item.HH !== null ? item.HH : null,
      hValue: item.H !== undefined && item.H !== null ? item.H : null,
      lValue: item.L !== undefined && item.L !== null ? item.L : null,
      llValue: item.LL !== undefined && item.LL !== null ? item.LL : null,
      minRange: item.qty_min !== undefined && item.qty_min !== null ? item.qty_min : null,
      maxRange: item.qty_max !== undefined && item.qty_max !== null ? item.qty_max : null,
      factory: item.factory || null,
      is_major_hazard: item.is_major_hazard || null,
      is_sis: item.is_sis || null
    }));
    
    res.json({
      success: true,
      data: devices
    });
    
  } catch (error) {
    console.error('获取设备列表错误:', error);
    res.status(500).json({
      success: false,
      message: '获取设备列表失败，请稍后重试'
    });
  }
});

// 批量获取历史数据接口
app.post('/api/history/batch', async (req, res) => {
  try {
    const { deviceTags, startTime, endTime, clientId } = req.body;
    console.log('历史数据批量查询请求:', { deviceTags, startTime, endTime, clientId });
    
    // 验证参数
    if (!deviceTags || !Array.isArray(deviceTags) || deviceTags.length === 0) {
      return res.json({
        code: 1,
        msg: '设备列表不能为空',
        clientId: clientId
      });
    }
    
    if (!startTime || !endTime) {
      return res.json({
        code: 1,
        msg: '时间范围不能为空',
        clientId: clientId
      });
    }
    
    // 从数据库查询真实的历史数据
    // 注意：这里需要根据实际的数据库结构和表名进行调整
    let realData = [];
    
    try {
      // 为每个设备查询历史数据
      for (const deviceTag of deviceTags) {
        // 构建查询SQL
        const sql = `
          SELECT timestamp, value 
          FROM scada_web.history_data 
          WHERE device_no = ? 
          AND timestamp BETWEEN ? AND ? 
          ORDER BY timestamp ASC
        `;
        
        // 执行查询
        const results = await queryDatabase(sql, [deviceTag, startTime, endTime]);
        
        // 格式化结果
        const dataPoints = results.map(row => ({
          time: row.timestamp,
          value: parseFloat(row.value)
        }));
        
        // 添加到结果数组
        realData.push({
          tag: deviceTag,
          data: dataPoints
        });
      }
    } catch (error) {
      console.error('查询历史数据失败:', error);
      // 如果查询失败，返回空数据
      realData = deviceTags.map(deviceTag => ({
        tag: deviceTag,
        data: []
      }));
    }
    
    // 使用真实数据或空数据
    const deviceData = realData;
    
    // 返回成功响应
    res.json({
      code: 0,
      msg: 'success',
      result: {
        data: deviceData
      },
      clientId: clientId
    });
    
  } catch (error) {
    console.error('历史数据查询错误:', error);
    res.json({
      code: 1,
      msg: '查询失败，请稍后重试',
      clientId: req.body.clientId || ''
    });
  }
});

// 启动服务器
app.listen(port, async () => {
  console.log('Server running on http://localhost:' + port);
  try {
    // 初始化数据库连接
    await initDatabaseConnection();
    console.log('数据库连接初始化完成');
    // 测试服务器是否正常运行
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

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    message: '服务器内部错误'
  });
});
