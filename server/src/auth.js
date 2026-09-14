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

// 鉴权中间件：
//   1. 第一优先：Nginx 探针注入的 X-Auth-User header（auth_request 已校验认证中心 token，内网信任）
//   2. 回退：双通道校验 blog JWT → Admin 会话（Redis admin:session）
async function requireAuth(req, res, next) {
  const authUser = req.headers['x-auth-user']
  if (authUser) {
    req.user = { username: authUser, via: 'nginx-auth-request' }
    return next()
  }

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

// 预览令牌：后台点开「草稿」文章页时用。
// 由管理接口（requireAuth）现场签发，短时效、绑定 slug —— 草稿因此不会对匿名访问者公开，
// 但后台拿着链接就能直接打开（含未发布）。
const PREVIEW_TTL = process.env.PREVIEW_TTL || '30m'

function signPreview(slug) {
  return jwt.sign({ preview: String(slug) }, SECRET, { expiresIn: PREVIEW_TTL })
}

function verifyPreview(token, slug) {
  if (!token) return false
  try {
    const payload = jwt.verify(token, SECRET)
    return payload && payload.preview === String(slug)
  } catch {
    return false
  }
}

// 软鉴权中间件：能识别身份就挂 req.user，识别不了也放行（不返回 401）。
// 用途：公开读接口里夹带「登录态才可见」的内容（如草稿预览）——由路由自己决定 404 还是放行。
async function optionalAuth(req, res, next) {
  const authUser = req.headers['x-auth-user']
  if (authUser) {
    req.user = { username: authUser, via: 'nginx-auth-request' }
    return next()
  }

  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return next()

  // 通道一：blog JWT
  try {
    req.user = verify(token)
    return next()
  } catch (err) {
    // 继续尝试第二通道
  }

  // 通道二：Admin 会话（Redis）
  try {
    if (await verifyAdminSession(token)) {
      req.user = { role: 'admin', via: 'admin-session' }
    }
  } catch (err) {
    /* Redis 不可用：视为匿名 */
  }
  return next()
}

module.exports = { sign, verify, requireAuth, optionalAuth, signPreview, verifyPreview }
