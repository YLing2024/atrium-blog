// routes/auth.js —— 管理员登录接口
// POST /api/admin/login：校验账号密码，签发 JWT

const express = require('express')
const bcrypt = require('bcryptjs')
const { db } = require('../db')
const { sign } = require('../auth')

const router = express.Router()

// 登录：成功后返回 { token, username }
router.post('/admin/login', (req, res) => {
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

  // 签发 7 天有效的 JWT
  const token = sign({ id: user.id, username: user.username })
  res.json({ token, username: user.username, message: '登录成功' })
})

module.exports = router
