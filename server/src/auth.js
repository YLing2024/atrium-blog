// auth.js —— JWT 签发 / 校验 / 鉴权中间件
// 密钥从环境变量 JWT_SECRET 读取，未设置时使用默认值 dev-secret

const jwt = require('jsonwebtoken')

// 签名密钥与有效期
const SECRET = process.env.JWT_SECRET || 'dev-secret'
const EXPIRES_IN = '7d'

// 签发 token
function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN })
}

// 校验 token，返回解析后的 payload（过期或非法会抛异常）
function verify(token) {
  return jwt.verify(token, SECRET)
}

// 鉴权中间件：校验请求头 Authorization: Bearer <token>
function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    return res.status(401).json({ message: '未登录，请先登录' })
  }
  try {
    // 校验成功，把用户信息挂载到请求对象上供后续使用
    req.user = verify(token)
    next()
  } catch (err) {
    return res.status(401).json({ message: '登录已过期，请重新登录' })
  }
}

module.exports = { sign, verify, requireAuth }
