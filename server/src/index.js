// index.js —— 博客 API 服务入口
// 启动 Express，挂载路由，监听 4000 端口（可用环境变量 PORT 覆盖）

const express = require('express')

// 引入路由前先加载 db.js，确保建表与种子数据已初始化
require('./db')

const postsRouter = require('./routes/posts')
const authRouter = require('./routes/auth')

const app = express()
const PORT = process.env.PORT || 4000

// 解析 JSON 请求体
app.use(express.json())

// 简单请求日志
app.use((req, _res, next) => {
  console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.originalUrl}`)
  next()
})

// 挂载路由：统一挂在 /api 下
app.use('/api', authRouter)  // POST /api/admin/login
app.use('/api', postsRouter) // /api/posts、/api/admin/posts ...

// 404 兜底：未匹配到任何路由
app.use((req, res) => {
  res.status(404).json({ message: '接口不存在' })
})

// 统一错误处理
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ message: '服务器内部错误' })
})

// 启动服务
app.listen(PORT, () => {
  console.log(`博客 API 服务已启动：http://localhost:${PORT}`)
})
