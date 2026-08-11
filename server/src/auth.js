// auth.js —— JWT 签发 / 校验 / 鉴权中间件
// 密钥从环境变量 JWT_SECRET 读取，未设置时使用默认值 dev-secret

const jwt = require('jsonwebtoken')
const Redis = require('ioredis')

// 签名密钥与有效期
const SECRET = process.env.JWT_SECRET || 'dev-secret'
const EXPIRES_IN = '7d'

// 双通道认证中的第二通道：Admin 会话（Redis admin:session:<token>）。
// 连接 127.0.0.1:6379，key 前缀可用环境变量 ADMIN_REDIS_PREFIX 覆盖，默认 admin:session:
// （与 admin-server 的会话 key 保持一致，Redis 异常不影响 blog JWT 主通道）
const ADMIN_REDIS_URL = process.env.ADMIN_REDIS_URL || 'redis://127.0.0.1:6379'
const ADMIN_SESSION_PREFIX = process.env.ADMIN_REDIS_PREFIX || 'admin:session:'
const ADMIN_SESSION_TTL = 43200 // 与 admin-server 一致：12 小时，校验通过滑动续期

const redis = new Redis(ADMIN_REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
})
redis.on('error', () => {
  // Redis 仅作第二认证通道，连接失败不退出进程（blog JWT 仍可用）
})

// 签发 token
function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN })
}

// 校验 token，返回解析后的 payload（过期或非法会抛异常）
function verify(token) {
  return jwt.verify(token, SECRET)
}

// 校验 Admin 会话：token 在任一前缀 key 中存在即视为有效（含滑动续期）
// 支持逗号分隔多前缀（如 'admin:session:,admin:session:test:'），兼容正式与测试会话
async function verifyAdminSession(token) {
  const prefixes = ADMIN_SESSION_PREFIX.split(',').map((s) => s.trim()).filter(Boolean)
  for (const prefix of prefixes) {
    const key = prefix + token
    try {
      const stored = await redis.get(key)
      if (stored && stored === token) {
        await redis.expire(key, ADMIN_SESSION_TTL)
        return true
      }
    } catch {
      /* 单前缀查询失败继续尝试下一个 */
    }
  }
  return false
}

// 鉴权中间件：优先校验 blog JWT（现有逻辑）；失败后回退校验 Admin 会话
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    return res.status(401).json({ message: '未登录，请先登录' })
  }

  // 通道一：blog JWT
  try {
    // 校验成功，把用户信息挂载到请求对象上供后续使用
    req.user = verify(token)
    return next()
  } catch (err) {
    // JWT 无效/过期，继续走第二通道
  }

  // 通道二：Admin 会话（Redis）
  try {
    if (await verifyAdminSession(token)) {
      req.user = { role: 'admin', via: 'admin-session' }
      return next()
    }
  } catch (err) {
    // Redis 不可用：视为未认证（blog JWT 主通道已失败）
  }
  return res.status(401).json({ message: '登录已过期，请重新登录' })
}

module.exports = { sign, verify, requireAuth }
