// routes/auth.js —— 管理端认证接口（builtin 模式）
//   GET  /api/blog/auth-mode     当前认证模式（免鉴权、两种模式都可用）
//   POST /api/blog/admin/login   校验账号密码，签发 JWT 并下发会话 cookie（仅 builtin）
//   POST /api/blog/admin/logout  删除会话 + 清 cookie，幂等（仅 builtin）
//   GET  /api/blog/admin/me      当前登录身份（仅 builtin）
// sso 模式下 admin/login、admin/logout、admin/me 一律 404（身份由 X-Auth-User 决定）。

const express = require('express')
const bcrypt = require('bcryptjs')
const { db } = require('../db')
const {
  AUTH_MODE,
  AUTH_MODE_COOKIE,
  sign,
  setAdminSession,
  destroyAdminSession,
  getBuiltinToken,
  sessionCookieOptions,
  clearSessionCookieOptions,
  requireAuth,
} = require('../auth')

const router = express.Router()

// sso 模式下自带账号接口一律 404（与未实现路由表现一致，不泄露模式细节外的信息）
function builtinOnly(req, res, next) {
  if (AUTH_MODE === 'sso') {
    return res.status(404).json({ message: '接口不存在' })
  }
  next()
}

// GET /api/blog/auth-mode（免鉴权）：只返回当前模式
router.get('/auth-mode', (req, res) => {
  res.json({ authMode: AUTH_MODE })
})

// POST /api/blog/admin/login：成功后返回 { token, username, message }，并下发 HttpOnly 会话 cookie
router.post('/admin/login', builtinOnly, async (req, res) => {
  const { username, password } = req.body || {}

  // 基础参数校验
  if (!username || !password) {
    return res.status(400).json({ message: '请输入账号和密码' })
  }

  // 查询用户并比对 bcrypt 密码哈希
  const user = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(username).trim())
  if (!user || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ message: '账号或密码错误' })
  }

  // 签发 7 天有效的 JWT，并写入会话 cookie（Path=/; HttpOnly; SameSite=Lax；HTTPS 加 Secure）
  const token = sign({ id: user.id, username: user.username })
  // 同时在 Redis 注册会话（key 与 admin-server 一致），登出才能立即失效；Redis 不可用时降级为纯 JWT
  await setAdminSession(token)
  res.cookie(AUTH_MODE_COOKIE, token, sessionCookieOptions(req))
  res.json({ token, username: user.username, message: '登录成功' })
})

// POST /api/blog/admin/logout：删 Redis 会话 + 清 cookie；未登录也 200（幂等）
router.post('/admin/logout', builtinOnly, async (req, res) => {
  // 凭证来源必须与 requireAuth 一致（Bearer 优先，其次 cookie）——
  // 只取 Authorization 头时，浏览器用 cookie 登录则登出删不到任何东西，旧会话仍然有效。
  await destroyAdminSession(getBuiltinToken(req))
  res.clearCookie(AUTH_MODE_COOKIE, clearSessionCookieOptions(req))
  res.json({ ok: true, message: '已退出登录' })
})

// GET /api/blog/admin/me：返回 { name, role }
router.get('/admin/me', builtinOnly, requireAuth, (req, res) => {
  const user = req.user || {}
  res.json({
    name: user.username || user.name || 'admin',
    role: user.role || 'admin',
  })
})

module.exports = router
