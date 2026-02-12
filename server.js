const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // 加载环境变量
const app = express();
const port = process.env.PORT || 3001;

// 启用CORS
app.use(cors());

// 解析JSON请求体
app.use(express.json());

// 确保临时目录存在
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// 配置multer文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    // 只接受CSV文件
    if (path.extname(file.originalname) === '.csv') {
      return cb(null, true);
    }
    cb(new Error('只支持CSV文件'));
  }
});

// 提供静态文件服务
app.use(express.static(__dirname));

// 根路径返回前端HTML文件
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/industrial-visualization-system.html');
});

// 连接MySQL - 主服务器
// 注意：使用环境变量中的数据库连接参数
const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  dialect: 'mysql',
  port: 3306,
  logging: console.log,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// 备用服务器配置
const sequelizeBackup = new Sequelize(process.env.DB_BACKUP_NAME, process.env.DB_BACKUP_USER, process.env.DB_BACKUP_PASSWORD, {
  host: process.env.DB_BACKUP_HOST,
  dialect: 'mysql',
  port: 3306,
  logging: console.log,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// 当前活动的数据库连接
let activeSequelize = sequelize;
let isMainServerActive = true;

// 测试数据库连接函数
async function testDatabaseConnection(connection, serverName) {
  try {
    await connection.authenticate();
    console.log(`${serverName} 数据库连接成功`);
    return true;
  } catch (err) {
    console.error(`${serverName} 数据库连接失败:`, err.message);
    return false;
  }
}

// 切换数据库连接函数
async function switchDatabaseConnection() {
  console.log('开始切换数据库连接...');
  
  if (isMainServerActive) {
    // 尝试连接备用服务器
    const backupConnected = await testDatabaseConnection(sequelizeBackup, '备用服务器');
    if (backupConnected) {
      activeSequelize = sequelizeBackup;
      isMainServerActive = false;
      console.log('已切换到备用服务器');
      // 重新同步模型到备用服务器
      resyncModelsOnSwitch();
      return true;
    }
  } else {
    // 尝试重新连接主服务器
    const mainConnected = await testDatabaseConnection(sequelize, '主服务器');
    if (mainConnected) {
      activeSequelize = sequelize;
      isMainServerActive = true;
      console.log('已切换回主服务器');
      // 重新同步模型到主服务器
      resyncModelsOnSwitch();
      return true;
    }
  }
  
  console.log('切换数据库连接失败，没有可用的服务器');
  return false;
}

// 初始化数据库连接
async function initializeDatabaseConnection() {
  console.log('初始化数据库连接...');
  
  // 首先尝试连接主服务器
  const mainConnected = await testDatabaseConnection(sequelize, '主服务器');
  if (mainConnected) {
    activeSequelize = sequelize;
    isMainServerActive = true;
    console.log('使用主服务器作为活动连接');
    return;
  }
  
  // 主服务器连接失败，尝试备用服务器
  console.log('主服务器连接失败，尝试连接备用服务器...');
  const backupConnected = await testDatabaseConnection(sequelizeBackup, '备用服务器');
  if (backupConnected) {
    activeSequelize = sequelizeBackup;
    isMainServerActive = false;
    console.log('使用备用服务器作为活动连接');
    return;
  }
  
  console.error('所有数据库服务器连接失败');
}

// 定期检查数据库连接状态
function startConnectionCheck() {
  setInterval(async () => {
    console.log('检查数据库连接状态...');
    const isConnected = await testDatabaseConnection(activeSequelize, isMainServerActive ? '主服务器' : '备用服务器');
    if (!isConnected) {
      console.log('当前数据库连接已断开，尝试切换服务器...');
      await switchDatabaseConnection();
    }
  }, 30000); // 每30秒检查一次
}

// 初始化数据库连接
initializeDatabaseConnection();

// 启动连接检查
startConnectionCheck();

// 定义设备模型 (从device_data表读取)
const Device = activeSequelize.define('Device', {
  device_no: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: '设备号'
  },
  description: {
    type: DataTypes.STRING,
    comment: '描述'
  },
  unit: {
    type: DataTypes.STRING,
    comment: '单位'
  },
  qty_max: {
    type: DataTypes.FLOAT,
    comment: '工程量上限'
  },
  qty_min: {
    type: DataTypes.FLOAT,
    comment: '工程量下限'
  },
  HH: {
    type: DataTypes.FLOAT,
    comment: '高高报'
  },
  H: {
    type: DataTypes.FLOAT,
    comment: '高报'
  },
  L: {
    type: DataTypes.FLOAT,
    comment: '低报'
  },
  LL: {
    type: DataTypes.FLOAT,
    comment: '低低报'
  },
  factory: {
    type: DataTypes.STRING,
    comment: '厂区'
  },
  level: {
    type: DataTypes.STRING,
    comment: '等级'
  },
  is_major_hazard: {
    type: DataTypes.STRING,
    comment: '是否重大危险源'
  },
  is_sis: {
    type: DataTypes.STRING,
    comment: '是否SIS系统'
  }
}, {
  tableName: 'device_data',
  timestamps: false,
  primaryKey: false
});

// 定义用户模型
const User = activeSequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  username: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('admin', 'operator', 'viewer', 'maint'),
    allowNull: false
  },
  adminLevel: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '行政级别'
  },
  permission: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '权限'
  },
  factory: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '厂区'
  }
}, {
  tableName: 'users',
  timestamps: true
});

// 定义历史数据模型
const HistoryData = activeSequelize.define('HistoryData', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  deviceTag: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: '设备位号'
  },
  value: {
    type: DataTypes.FLOAT,
    allowNull: false,
    comment: '数据值'
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false,
    comment: '时间戳'
  },
  clientId: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: '客户端ID'
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'history_data',
  timestamps: true
});

// 同步数据库模型
function syncDatabaseModels() {
  activeSequelize.sync({ alter: true })
    .then(() => {
      console.log('数据库模型同步成功');
    })
    .catch(err => {
      console.error('数据库模型同步失败:', err);
    });
}

// 初始化时同步模型并创建默认admin用户
async function initDatabase() {
  await syncDatabaseModels();
  
  // 创建默认admin用户（如果不存在）
  try {
    const existingAdmin = await User.findOne({ where: { username: 'admin' } });
    if (!existingAdmin) {
      const hashedPassword = bcrypt.hashSync('admin', bcrypt.genSaltSync(10));
      await User.create({
        username: 'admin',
        password: hashedPassword,
        role: 'admin'
      });
      console.log('默认admin用户创建成功');
    } else {
      console.log('admin用户已存在');
    }
  } catch (error) {
    console.error('创建默认admin用户失败:', error.message);
  }
}

// 初始化数据库
initDatabase();

// 切换服务器时重新同步模型
function resyncModelsOnSwitch() {
  // 在切换服务器后调用此函数
  syncDatabaseModels();
}

// 健康检查API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '服务运行正常' });
});

// MySQL服务器状态API
app.get('/api/mysql/status', async (req, res) => {
  try {
    // 检查主服务器状态
    const primaryStatus = await testDatabaseConnection(sequelize, '主服务器');
    
    // 检查备用服务器状态
    const backupStatus = await testDatabaseConnection(sequelizeBackup, '备用服务器');
    
    res.json({
      success: true,
      data: {
        primary: primaryStatus,
        backup: backupStatus,
        active: isMainServerActive ? 'primary' : 'backup'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取MySQL状态失败',
      error: error.message
    });
  }
});

// 用户认证API

// 登录验证API
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // 查找用户
    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: '用户名或密码错误' 
      });
    }
    
    // 使用bcrypt验证密码
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: '用户名或密码错误' 
      });
    }
    
    // 生成JWT令牌
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'your_secret_key',
      { expiresIn: '24h' }
    );
    
    // 返回成功信息
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '登录失败',
      error: error.message
    });
  }
});

// 注册用户API
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    // 检查用户是否已存在
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: '用户名已存在' 
      });
    }
    
    // 使用bcrypt加密密码
    const hashedPassword = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
    
    // 创建用户
    const user = await User.create({
      username,
      password: hashedPassword, // 存储加密后的密码
      role: role || 'viewer'
    });
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '注册失败',
      error: error.message
    });
  }
});

// 导入用户API
app.post('/api/auth/import', upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: '请选择CSV文件' 
      });
    }
    
    const results = [];
    const errors = [];
    
    // 解析CSV文件
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', async (data) => {
        try {
          // 提取用户信息
          const username = data.username || data.账号;
          const password = data.password || data.密码;
          const role = data.role || data.权限 || 'viewer';
          const adminLevel = data.adminLevel || data.行政级别;
          const permission = data.permission || data.权限;
          const factory = data.factory || data.厂区;
          
          // 验证必填字段
          if (!username || !password) {
            errors.push({ 
              username: username || '未知', 
              error: '缺少用户名或密码' 
            });
            return;
          }
          
          // 验证角色
          const validRoles = ['admin', 'operator', 'viewer', 'maint'];
          if (!validRoles.includes(role)) {
            errors.push({ 
              username: username, 
              error: '角色无效，必须是 admin, operator, viewer 或 maint' 
            });
            return;
          }
          
          // 检查用户是否已存在
          const existingUser = await User.findOne({ where: { username } });
          if (existingUser) {
            errors.push({ 
              username: username, 
              error: '用户名已存在' 
            });
            return;
          }
          
          // 使用bcrypt加密密码
          const hashedPassword = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
          
          // 创建用户
          const user = await User.create({
            username,
            password: hashedPassword,
            role,
            adminLevel,
            permission,
            factory
          });
          
          results.push({ 
            username: user.username, 
            role: user.role, 
            adminLevel: user.adminLevel, 
            permission: user.permission, 
            factory: user.factory, 
            status: '成功' 
          });
        } catch (error) {
          errors.push({ 
            username: data.username || data.账号 || '未知', 
            error: error.message 
          });
        }
      })
      .on('end', () => {
        // 删除临时文件
        fs.unlinkSync(req.file.path);
        
        // 返回结果
        res.json({
          success: true,
          message: `导入完成，成功 ${results.length} 个，失败 ${errors.length} 个`,
          data: {
            success: results,
            errors: errors
          }
        });
      })
      .on('error', (error) => {
        // 删除临时文件
        fs.unlinkSync(req.file.path);
        
        res.status(500).json({
          success: false,
          message: '解析CSV文件失败',
          error: error.message
        });
      });
  } catch (error) {
    // 删除临时文件
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: '导入失败',
      error: error.message
    });
  }
});

// 设备管理API

// 获取所有设备
app.get('/api/devices', async (req, res) => {
  try {
    const { search } = req.query;
    let devices;
    
    if (search) {
      // 搜索设备
      devices = await Device.findAll({
        where: {
          device_no: {
            [Op.like]: `%${search}%`
          }
        }
      });
    } else {
      // 获取所有设备
      devices = await Device.findAll();
    }
    
    res.json({
      success: true,
      data: devices,
      message: `获取到 ${devices.length} 个设备`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取设备列表失败',
      error: error.message
    });
  }
});

// 根据设备号获取设备
app.get('/api/devices/:device_no', async (req, res) => {
  try {
    const { device_no } = req.params;
    const device = await Device.findOne({ where: { device_no } });
    if (device) {
      res.json({
        success: true,
        data: device,
        message: '获取设备成功'
      });
    } else {
      res.status(404).json({
        success: false,
        message: '设备不存在'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取设备失败',
      error: error.message
    });
  }
});

// 添加设备
app.post('/api/devices', async (req, res) => {
  try {
    const deviceData = req.body;
    const device = await Device.create(deviceData);
    res.status(201).json({
      success: true,
      data: device,
      message: '添加设备成功'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '添加设备失败',
      error: error.message
    });
  }
});

// 更新设备
app.put('/api/devices/:device_no', async (req, res) => {
  try {
    const { device_no } = req.params;
    const deviceData = req.body;
    const [updated] = await Device.update(deviceData, { where: { device_no } });
    if (updated) {
      const updatedDevice = await Device.findOne({ where: { device_no } });
      res.json({
        success: true,
        data: updatedDevice,
        message: '更新设备成功'
      });
    } else {
      res.status(404).json({
        success: false,
        message: '设备不存在'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '更新设备失败',
      error: error.message
    });
  }
});

// 删除设备
app.delete('/api/devices/:device_no', async (req, res) => {
  try {
    const { device_no } = req.params;
    const deleted = await Device.destroy({ where: { device_no } });
    if (deleted) {
      res.json({
        success: true,
        message: '删除设备成功'
      });
    } else {
      res.status(404).json({
        success: false,
        message: '设备不存在'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '删除设备失败',
      error: error.message
    });
  }
});

// 历史数据API

// 添加历史数据
app.post('/api/history', async (req, res) => {
  try {
    const historyData = req.body;
    
    // 验证clientId
    if (!historyData.clientId) {
      return res.status(400).json({
        success: false,
        message: '缺少客户端ID'
      });
    }
    
    const data = await HistoryData.create(historyData);
    res.status(201).json({
      success: true,
      data: data,
      message: '添加历史数据成功'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '添加历史数据失败',
      error: error.message
    });
  }
});

// 批量添加历史数据
app.post('/api/history/batch', async (req, res) => {
  try {
    const historyDataList = req.body;
    
    // 验证所有数据都包含clientId
    for (const data of historyDataList) {
      if (!data.clientId) {
        return res.status(400).json({
          success: false,
          message: '缺少客户端ID'
        });
      }
    }
    
    const data = await HistoryData.bulkCreate(historyDataList);
    res.status(201).json({
      success: true,
      data: data,
      message: `批量添加 ${data.length} 条历史数据成功`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '批量添加历史数据失败',
      error: error.message
    });
  }
});

// 查询历史数据
app.get('/api/history', async (req, res) => {
  try {
    const { deviceTag, startTime, endTime, limit = 100, clientId } = req.query;
    
    // 验证客户端ID
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: '缺少客户端ID'
      });
    }
    
    const where = {
      clientId: clientId // 根据clientId过滤数据
    };
    
    if (deviceTag) {
      where.deviceTag = deviceTag;
    }
    
    if (startTime && endTime) {
      where.timestamp = {
        [Op.between]: [new Date(startTime), new Date(endTime)]
      };
    } else if (startTime) {
      where.timestamp = {
        [Op.gte]: new Date(startTime)
      };
    } else if (endTime) {
      where.timestamp = {
        [Op.lte]: new Date(endTime)
      };
    }
    
    const history = await HistoryData.findAll({
      where,
      order: [['timestamp', 'DESC']],
      limit: parseInt(limit)
    });
    
    // 转换为前端期望的格式
    const deviceDataMap = {};
    
    history.forEach(item => {
      const deviceName = item.deviceTag; // 使用deviceTag作为name
      if (!deviceDataMap[deviceName]) {
        deviceDataMap[deviceName] = [];
      }
      
      deviceDataMap[deviceName].push({
        q: 1, // 假设质量为1（良好）
        time: new Date(item.timestamp).getTime(), // 转换为时间戳
        type: 8, // 假设类型为8
        val: item.value // 使用value作为val
      });
    });
    
    // 构建前端期望的响应格式
    const formattedData = Object.entries(deviceDataMap).map(([name, datalist]) => ({
      name,
      datalist
    }));
    
    res.json({
      code: 0,
      method: "HistoryData",
      msg: "Query succeeded",
      result: {
        data: formattedData
      },
      clientId: clientId
    });
  } catch (error) {
    res.status(500).json({
      code: 1,
      method: "HistoryData",
      msg: "Query failed",
      result: {
        error: error.message
      },
      clientId: clientId
    });
  }
});

// 批量查询历史数据API
app.post('/api/history/batch', async (req, res) => {
  try {
    const { deviceTags, startTime, endTime, clientId } = req.body;
    
    // 验证客户端ID
    if (!clientId) {
      return res.status(400).json({
        code: 1,
        method: "HistoryData",
        msg: "Missing clientId",
        result: {
          error: '缺少客户端ID'
        }
      });
    }
    
    // 验证参数
    if (!deviceTags || !Array.isArray(deviceTags) || deviceTags.length === 0) {
      return res.status(400).json({
        code: 1,
        method: "HistoryData",
        msg: "Missing device tags",
        result: {
          error: '请提供设备位号列表'
        }
      });
    }
    
    const formattedData = [];
    
    // 为每个设备查询历史数据
    for (const tag of deviceTags) {
      const where = {
        deviceTag: tag,
        clientId: clientId // 根据clientId过滤数据
      };
      
      if (startTime && endTime) {
        where.timestamp = {
          [Op.between]: [new Date(startTime), new Date(endTime)]
        };
      }
      
      const data = await HistoryData.findAll({
        where,
        order: [['timestamp', 'ASC']],
        limit: 1000
      });
      
      // 转换为前端期望的格式
      const datalist = data.map(item => ({
        q: 1, // 假设质量为1（良好）
        time: new Date(item.timestamp).getTime(), // 转换为时间戳
        type: 8, // 假设类型为8
        val: item.value // 使用value作为val
      }));
      
      formattedData.push({
        name: tag, // 使用deviceTag作为name
        datalist
      });
    }
    
    res.json({
      code: 0,
      method: "HistoryData",
      msg: "Query succeeded",
      result: {
        data: formattedData
      },
      clientId: clientId
    });
  } catch (error) {
    res.status(500).json({
      code: 1,
      method: "HistoryData",
      msg: "Query failed",
      result: {
        error: error.message
      },
      clientId: clientId
    });
  }
});

// 启动服务器
app.listen(port, () => {
  console.log(`服务器运行在 http://localhost:${port}`);
  console.log(`健康检查: http://localhost:${port}/api/health`);
  console.log(`设备列表: http://localhost:${port}/api/devices`);
});
