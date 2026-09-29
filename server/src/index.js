// index.js —— 博客 API 服务入口
// 启动 Express，挂载路由，监听 4000 端口（可用环境变量 PORT 覆盖）

const express = require('express')

// 引入路由前先加载 db.js，确保建表与种子数据已初始化
require('./db')

const postsRouter = require('./routes/posts')
const authRouter = require('./routes/auth')
const { logAuthMode } = require('./auth')

const app = express()
const PORT = process.env.PORT || 4000

// 解析 JSON 请求体
app.use(express.json())

// 简单请求日志
app.use((req, _res, next) => {
  console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.originalUrl}`)
  next()
})

// 挂载路由：统一挂在 /api/blog 下（与 admin-server 的 /api/admin 隔离）
app.use('/api/blog', authRouter)  // /api/blog/auth-mode、/api/blog/admin/login|logout|me
app.use('/api/blog', postsRouter) // /api/blog/posts、/api/blog/admin/posts ...

// 404 兜底：未匹配到任何路由
app.use((req, res) => {
  res.status(404).json({ message: '接口不存在' })
})

// 统一错误处理
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ message: '服务器内部错误' })
})

// 启动服务（仅绑定 127.0.0.1：nginx 反代可达，杜绝公网直连伪造 X-Auth-User 绕过 SSO）
app.listen(PORT, '127.0.0.1', () => {
  // 启动日志：明确打印当前管理端认证模式
  logAuthMode()
  console.log(`博客 API 服务已启动：http://localhost:${PORT}`)
})
