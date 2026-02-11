const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const cors = require('cors');
const app = express();
const port = 3001;

// 启用CORS
app.use(cors());

// 解析JSON请求体
app.use(express.json());

// 连接MySQL
// 注意：请根据实际情况修改数据库连接参数
const sequelize = new Sequelize('webtest', 'webuser', 'webuser', {
  host: '192.168.10.179',
  dialect: 'mysql',
  port: 3306,
  logging: console.log
});

// 测试数据库连接
sequelize.authenticate()
  .then(() => {
    console.log('数据库连接成功');
  })
  .catch(err => {
    console.error('数据库连接失败:', err);
  });

// 定义设备模型 (从tagval表读取)
const Device = sequelize.define('Device', {
  name: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false,
    comment: '设备位号'
  },
  desc: {
    type: DataTypes.STRING,
    comment: '描述'
  },
  SI: {
    type: DataTypes.STRING,
    comment: '单位'
  },
  HH: {
    type: DataTypes.FLOAT,
    comment: '高高报'
  },
  H: {
    type: DataTypes.FLOAT,
    comment: '高报'
  },
  LL: {
    type: DataTypes.FLOAT,
    comment: '低低报'
  },
  L: {
    type: DataTypes.FLOAT,
    comment: '低报'
  },
  VL: {
    type: DataTypes.FLOAT,
    comment: '量程下限'
  },
  VH: {
    type: DataTypes.FLOAT,
    comment: '量程上限'
  }
}, {
  tableName: 'tagval',
  timestamps: false,
  primaryKey: false
});

// 定义历史数据模型
const HistoryData = sequelize.define('HistoryData', {
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
sequelize.sync({ alter: true })
  .then(() => {
    console.log('数据库模型同步成功');
  })
  .catch(err => {
    console.error('数据库模型同步失败:', err);
  });

// 健康检查API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '服务运行正常' });
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
          name: {
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

// 根据位号获取设备
app.get('/api/devices/:tag', async (req, res) => {
  try {
    const { tag } = req.params;
    const device = await Device.findOne({ where: { tag } });
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
app.put('/api/devices/:tag', async (req, res) => {
  try {
    const { tag } = req.params;
    const deviceData = req.body;
    const [updated] = await Device.update(deviceData, { where: { tag } });
    if (updated) {
      const updatedDevice = await Device.findOne({ where: { tag } });
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
app.delete('/api/devices/:tag', async (req, res) => {
  try {
    const { tag } = req.params;
    const deleted = await Device.destroy({ where: { tag } });
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
