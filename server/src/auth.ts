// auth.ts —— 认证模式解析 / JWT 签发校验 / Admin 会话校验 / 鉴权中间件
//
// 认证模式（AUTH_MODE，未设置或非法值一律按 builtin）：
//   builtin —— 自带账号体系：bcrypt 登录 + blog JWT + Redis admin 会话（含 HttpOnly cookie）
//   sso     —— 关掉自带口令，管理端身份只认前置认证注入的 X-Auth-User
//
// 两种模式都保留公开读接口的匿名访问；X-Auth-User 在 builtin 模式下被忽略（不因外部头提权）。

import type { Request, Response, NextFunction, CookieOptions } from 'express'
import type { JwtPayload, SignOptions } from 'jsonwebtoken'
import type { Redis, RedisOptions } from 'ioredis'

type AuthMode = 'builtin' | 'sso'
// 通过鉴权后挂在 req.user 上的身份对象（不同来源字段略有差异）
type AuthUser = {
  id?: number
  username?: string
  name?: string
  role?: string
  via?: string
  [key: string]: unknown
}

// 向 Express Request 增补 user 字段（仅类型增补，运行时无影响）
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser
  }
}

const jwt = require('jsonwebtoken') as {
  sign: typeof import('jsonwebtoken').sign
  verify: typeof import('jsonwebtoken').verify
}
const RedisCtor = require('ioredis') as {
  new (url: string, options?: RedisOptions): Redis
}

// 签名密钥与有效期
const SECRET: string = process.env.JWT_SECRET || 'dev-secret'
const EXPIRES_IN = '7d'

// ---------- 认证模式解析 ----------
function normalizeAuthMode(raw: unknown): AuthMode {
  const value = String(raw == null ? '' : raw).trim().toLowerCase()
  if (value === 'sso') return 'sso'
  if (value === 'builtin') return 'builtin'
  if (value) {
    console.warn(`[blog] AUTH_MODE 取值非法（${value}），回退 builtin`)
  }
  return 'builtin'
}

const AUTH_MODE: AuthMode = normalizeAuthMode(process.env.AUTH_MODE)

// 启动日志文案（由入口调用，保证只有一处打印）
function authModeLabel(mode: AuthMode = AUTH_MODE): string {
  return mode === 'sso' ? 'SSO（信任 X-Auth-User）' : '自带账号（builtin）'
}

function logAuthMode(): void {
  console.log(`管理端认证模式: ${authModeLabel()}`)
}

// 双通道认证中的第二通道：Admin 会话（Redis admin:session:<token>）。
// 连接 127.0.0.1:6379，key 前缀可用环境变量 ADMIN_REDIS_PREFIX 覆盖，默认 admin:session:
// （与 admin-server 的会话 key 保持一致，Redis 异常不影响 blog JWT 主通道）
const ADMIN_REDIS_URL: string = process.env.ADMIN_REDIS_URL || 'redis://127.0.0.1:6379'
const ADMIN_SESSION_PREFIX: string = process.env.ADMIN_REDIS_PREFIX || 'admin:session:'
const ADMIN_SESSION_TTL: number = 43200 // 与 admin-server 一致：12 小时，校验通过滑动续期

// 会话 cookie：builtin 模式下登录后下发，RequireAuth 接受它作为 Bearer 的等价凭证
const ADMIN_SESSION_COOKIE = 'admin_session'

const redis: Redis = new RedisCtor(ADMIN_REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
})
redis.on('error', () => {
  // Redis 仅作第二认证通道，连接失败不退出进程（blog JWT 仍可用）
})

// 会话前缀列表：支持逗号分隔多前缀（如 'admin:session:,admin:session:test:'）
function adminSessionPrefixes(): string[] {
  return ADMIN_SESSION_PREFIX.split(',').map((s) => s.trim()).filter(Boolean)
}

// 签发 token
function sign(payload: object): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN })
}

// 校验 token，返回解析后的 payload（过期或非法会抛异常）
function verify(token: string): string | JwtPayload {
  return jwt.verify(token, SECRET)
}

// 校验 Admin 会话：token 在任一前缀 key 中存在即视为有效（含滑动续期）
async function verifyAdminSession(token: string): Promise<boolean> {
  for (const prefix of adminSessionPrefixes()) {
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

// 写入 Admin 会话（登录用）：key = 前缀 + token，值为 token 本身，TTL 与滑动续期一致。
// Redis 不可用时失败静默 —— 此时退回纯 JWT（见 verifyBuiltinToken 的降级分支）。
async function setAdminSession(token: string): Promise<boolean> {
  if (!token) return false
  const prefixes = adminSessionPrefixes()
  try {
    await redis.set(prefixes[0] + token, token, 'EX', ADMIN_SESSION_TTL)
    return true
  } catch {
    return false
  }
}

// 查询会话状态：'valid' 会话存在 / 'missing' Redis 可达但没有该会话 / 'unavailable' Redis 不可用。
// 必须区分后两者：只按「JWT 有效」放行会让 logout 形同虚设（删了会话，旧 JWT 照样能用）。
async function redisSessionState(token: string): Promise<'valid' | 'missing' | 'unavailable'> {
  if (!token) return 'missing'
  let sawError = false
  for (const prefix of adminSessionPrefixes()) {
    try {
      const stored = await redis.get(prefix + token)
      if (stored && stored === token) {
        await redis.expire(prefix + token, ADMIN_SESSION_TTL)
        return 'valid'
      }
    } catch {
      sawError = true
    }
  }
  return sawError ? 'unavailable' : 'missing'
}

// 删除 Admin 会话（logout 用）：删除任一前缀下的 key，失败静默（幂等）
async function destroyAdminSession(token: string): Promise<void> {
  if (!token) return
  for (const prefix of adminSessionPrefixes()) {
    try {
      await redis.del(prefix + token)
    } catch {
      /* Redis 不可用时忽略：logout 幂等 */
    }
  }
}

// ---------- 凭证来源 ----------

// 解析 Cookie 头（不引入额外依赖）
function parseCookies(cookieHeader: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  String(cookieHeader || '')
    .split(';')
    .forEach((part) => {
      const idx = part.indexOf('=')
      if (idx < 0) return
      const key = part.slice(0, idx).trim()
      if (key) out[key] = part.slice(idx + 1).trim()
    })
  return out
}

// 取 Authorization: Bearer <token>
function getBearerToken(req: Request): string {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

// builtin 模式取凭证：Bearer 优先，其次 admin_session cookie
function getBuiltinToken(req: Request): string {
  return getBearerToken(req) || parseCookies(req.headers.cookie)[ADMIN_SESSION_COOKIE] || ''
}

// 校验 builtin 凭证：先试图作为 blog JWT，再作为 Redis admin 会话。成功返回有 req.user 形态的对象
async function verifyBuiltinToken(token: string): Promise<AuthUser | null> {
  if (!token) return null

  let jwtUser: JwtPayload | null = null
  try {
    // 本项目只签对象 payload；verify 的声明返回 string | JwtPayload，这里按对象收窄
    jwtUser = verify(token) as JwtPayload
  } catch {
    /* 非 JWT 或已过期：继续看 Redis 会话通道 */
  }

  const state = await redisSessionState(token)
  if (state === 'valid') {
    return { ...(jwtUser || { role: 'admin' }), via: jwtUser ? 'jwt+session' : 'admin-session' }
  }
  if (state === 'unavailable' && jwtUser) {
    // Redis 不可用时的降级：退回纯 JWT（此时无法做到登出即失效，属已知取舍）
    return { ...jwtUser, via: 'jwt-redis-down' }
  }
  return null
}

// ---------- 鉴权中间件 ----------

// 是否为 HTTPS 请求（cookie Secure 判定；同时兼容反代）
function isSecureRequest(req: Request): boolean {
  if (req.secure) return true
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
  return proto === 'https'
}

// 会话 cookie 选项：Path=/; HttpOnly; SameSite=Lax；HTTPS 下加 Secure
function sessionCookieOptions(req: Request): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_SESSION_TTL * 1000,
    secure: isSecureRequest(req),
  }
}

// 清除会话 cookie 的选项：与下发时同样式，但不带 maxAge。
// clearCookie 传 maxAge 在 Express 4/5 上都会打废弃警告（且 v5 起被忽略），
// 而清除语义本来就该由 Expires 在过去承担 —— 这里显式去掉，避免每次登出都往日志吐警告。
function clearSessionCookieOptions(req: Request): CookieOptions {
  const { maxAge, ...rest } = sessionCookieOptions(req)
  return rest
}

// 鉴权中间件：
//   builtin —— 接受 Bearer / admin_session cookie，校验 blog JWT 或 Redis 会话
//   sso     —— 只认 X-Auth-User（缺失/空 → 401）；不解析 cookie/JWT
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (AUTH_MODE === 'sso') {
    const authUser = req.headers['x-auth-user']
    if (authUser && String(authUser).trim()) {
      req.user = { username: String(authUser), via: 'gateway' }
      return next()
    }
    return res.status(401).json({ message: '未登录，请先登录' })
  }

  // builtin：忽略 X-Auth-User，只用自带账号凭证
  const token = getBuiltinToken(req)
  if (!token) {
    return res.status(401).json({ message: '未登录，请先登录' })
  }
  const user = await verifyBuiltinToken(token)
  if (user) {
    req.user = user
    return next()
  }
  return res.status(401).json({ message: '登录已过期，请重新登录' })
}

// 软鉴权中间件：能识别身份就挂 req.user，识别不了也放行（不返回 401）。
// 用途：公开读接口里夹带「登录态才可见」的内容（如草稿预览）——由路由自己决定 404 还是放行。
async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  if (AUTH_MODE === 'sso') {
    const authUser = req.headers['x-auth-user']
    if (authUser && String(authUser).trim()) {
      req.user = { username: String(authUser), via: 'gateway' }
    }
    return next()
  }

  const token = getBuiltinToken(req)
  if (token) {
    const user = await verifyBuiltinToken(token)
    if (user) req.user = user
  }
  return next()
}

// 预览令牌：后台点开「草稿」文章页时用。
// 由管理接口（requireAuth）现场签发，短时效、绑定 slug —— 草稿因此不会对匿名访问者公开，
// 但后台拿着链接就能直接打开（含未发布）。
const PREVIEW_TTL: string = process.env.PREVIEW_TTL || '30m'

function signPreview(slug: string): string {
  // PREVIEW_TTL 来自环境变量（字符串），jsonwebtoken 只接受字面量时长的联合类型，这里按声明收窄
  return jwt.sign({ preview: String(slug) }, SECRET, {
    expiresIn: PREVIEW_TTL as SignOptions['expiresIn'],
  })
}

function verifyPreview(token: string | undefined, slug: unknown): boolean {
  if (!token) return false
  try {
    const payload = jwt.verify(token, SECRET)
    return payload != null && typeof payload === 'object' && payload.preview === String(slug)
  } catch {
    return false
  }
}

module.exports = {
  AUTH_MODE,
  AUTH_MODE_COOKIE: ADMIN_SESSION_COOKIE,
  authModeLabel,
  logAuthMode,
  sign,
  verify,
  verifyAdminSession,
  setAdminSession,
  destroyAdminSession,
  getBuiltinToken,
  sessionCookieOptions,
  clearSessionCookieOptions,
  requireAuth,
  optionalAuth,
  signPreview,
  verifyPreview,
}
