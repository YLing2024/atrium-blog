// routes/posts.js —— 文章相关路由
// 公开接口（无需鉴权）：
//   GET /api/posts          文章列表（仅已发布，支持 ?page= & tag=）
//   GET /api/posts/:slug    文章详情（已发布公开；草稿仅登录态可见，供后台点标题预览）
// 管理接口（需鉴权 requireAuth）：
//   GET    /api/admin/posts        全部文章（含草稿）
//   POST   /api/admin/posts        新建文章
//   PUT    /api/admin/posts/:id    更新文章
//   DELETE /api/admin/posts/:id    删除文章

const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const { db, parseTags, rebuildTags } = require('../db')
const { requireAuth, optionalAuth, signPreview, verifyPreview } = require('../auth')
const { nextId } = require('../snowflake')

const router = express.Router()

// 公共站点基址：运行期注入；未配置时回退相对路径并显式告警（不静默给出错链接）
// 后台在独立子域上打开 preview-link，相对路径会落到后台自身 SPA，故必须用绝对地址
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '')
let warnedMissingSiteUrl = false
function publicSiteUrl() {
  if (!PUBLIC_SITE_URL && !warnedMissingSiteUrl) {
    warnedMissingSiteUrl = true
    console.warn('[blog] PUBLIC_SITE_URL 未配置，preview-link 将返回相对地址（后台点在子域上会打不开）')
  }
  return PUBLIC_SITE_URL
}

// ---- 博客图片上传（管理接口）：存 uploads/，公开访问 /api/blog/uploads/<name> ----
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10)
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`)
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
})

// POST /api/blog/admin/upload（需鉴权）：返回 { url: '/api/blog/uploads/<name>' }
router.post('/admin/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: '未收到图片（字段名 image）' })
  res.json({ url: `/api/blog/uploads/${req.file.filename}` })
})

// GET /api/blog/uploads/:name（公开）：返回图片文件
router.get('/uploads/:name', (req, res) => {
  const name = path.basename(req.params.name || '')
  if (!name || name.includes('..')) return res.status(400).json({ message: '非法文件名' })
  const file = path.join(UPLOAD_DIR, name)
  if (!fs.existsSync(file)) return res.status(404).json({ message: '图片不存在' })
  res.sendFile(file)
})

// 列表每页条数
const PAGE_SIZE = 10

// 文章查询字段：附带合集信息（LEFT JOIN collections，别名避免列名冲突）
const POST_COLS = `
  p.id, p.title, p.slug, p.public_id, p.content, p.excerpt, p.tags, p.published,
  p.created_at, p.updated_at,
  c.id AS collection_id, c.name AS collection_name, c.slug AS collection_slug,
  c.public_id AS collection_public_id
`
const POST_COLS_NO_CONTENT = `
  p.id, p.title, p.slug, p.public_id, p.excerpt, p.tags, p.published, p.created_at, p.updated_at,
  c.id AS collection_id, c.name AS collection_name, c.slug AS collection_slug,
  c.public_id AS collection_public_id
`
// 文章查询统一拼接的 JOIN 片段
const POST_JOIN =
  'FROM posts p LEFT JOIN collections c ON c.id = p.collection_id'

// ---------- 工具函数 ----------

// 生成 slug：转小写、空格转短横线、过滤非法字符
// 中文标题无法生成可用 slug 时，退回 <fallback>-<时间戳> 形式（默认 post）
function slugify(text, fallback = 'post') {
  const slug = String(text || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '')
    .replace(/^-+|-+$/g, '')
  return slug || `${fallback}-${Date.now()}`
}

// 校验并解析 collection_id（空/null 视为不关联合集，返回 null）
// 返回 null 表示无合集；返回 undefined 表示参数未提供（用于区分"不改动"）
function parseCollectionId(collectionId) {
  if (collectionId === undefined) return undefined
  if (collectionId === null || collectionId === '') return null
  const id = Number(collectionId)
  if (!Number.isInteger(id) || id <= 0) return null
  const exists = db.prepare('SELECT id FROM collections WHERE id = ?').get(id)
  return exists ? id : null
}

// 把数据库行整理成对外结构：published 转布尔、tags 转数组、collection 为对象或 null
function toPost(row) {
  if (!row) return null
  const { collection_id, collection_name, collection_slug, collection_public_id, ...rest } = row
  return {
    ...rest,
    published: !!row.published,
    tags: parseTags(row.tags),
    collection:
      collection_id != null
        ? {
            id: collection_id,
            name: collection_name,
            slug: collection_slug,
            public_id: collection_public_id || '',
          }
        : null,
  }
}

// 对 LIKE 通配符做转义，防止标签名被误当通配符
function escapeLike(str) {
  return String(str).replace(/[\\%_]/g, (c) => `\\${c}`)
}

// slug 退化为内部别名（URL 已改用雪花 public_id）：重名不再报 409，自动加序号后缀
function uniqueSlug(table, base, excludeId = null) {
  const find = db.prepare(`SELECT id FROM ${table} WHERE slug = ?`)
  let candidate = base
  let n = 1
  for (;;) {
    const row = find.get(candidate)
    if (!row || row.id === excludeId) return candidate
    n += 1
    candidate = `${base}-${n}`
  }
}

// ---------- 公开接口 ----------

// GET /api/posts 公开文章列表：仅 published=1，支持 ?page=&tag=
router.get('/posts', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const tag = String(req.query.tag || '').trim()

  // 动态拼接筛选条件
  const conditions = ['p.published = 1']
  const params = []
  if (tag) {
    // 用 "," + tags + "," 包起来做匹配，避免"前端"误匹配"前后端"
    conditions.push("(',' || p.tags || ',') LIKE ? ESCAPE '\\'")
    params.push(`%,${escapeLike(tag)},%`)
  }
  const where = conditions.join(' AND ')

  // 总数与总页数
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${where}`)
    .get(...params).n
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)

  // 分页查询（列表接口不返回正文，减小传输量）
  const list = db
    .prepare(
      `SELECT ${POST_COLS_NO_CONTENT}
       ${POST_JOIN}
       WHERE ${where}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, PAGE_SIZE, (safePage - 1) * PAGE_SIZE)
    .map(toPost)

  res.json({
    list,
    page: safePage,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  })
})

// 解析文章：优先按雪花 public_id（现行 URL），其次按 slug（兼容历史链接）
function findPostByKey(key) {
  const k = String(key || '')
  if (!k) return undefined
  const byPublicId = db
    .prepare(`SELECT ${POST_COLS} ${POST_JOIN} WHERE p.public_id = ?`)
    .get(k)
  if (byPublicId) return byPublicId
  return db.prepare(`SELECT ${POST_COLS} ${POST_JOIN} WHERE p.slug = ?`).get(k)
}

// GET /api/posts/:slug 文章详情（:slug 可为雪花 public_id 或历史 slug）
//   已发布 → 任何人可读
//   草稿    → 仅「登录态」或有效预览令牌（?preview=）可读 —— 后台从列表点标题即走后者
router.get('/posts/:slug', optionalAuth, (req, res) => {
  const post = findPostByKey(req.params.slug)
  const canPreview =
    !!req.user || verifyPreview(req.query.preview, req.params.slug)
  if (!post || (!post.published && !canPreview)) {
    return res.status(404).json({ message: '文章不存在或未发布' })
  }
  res.json(toPost(post))
})

// ---------- 合集公开接口 ----------

// GET /api/collections 公开合集列表：含已发布文章数
router.get('/collections', (req, res) => {
  const list = db
    .prepare(
      `SELECT c.id, c.name, c.slug, c.public_id, c.description, c.created_at,
              COUNT(p.id) AS post_count
       FROM collections c
       LEFT JOIN posts p ON p.collection_id = c.id AND p.published = 1
       GROUP BY c.id
       ORDER BY c.created_at ASC, c.id ASC`
    )
    .all()
    .map((row) => ({ ...row, post_count: Number(row.post_count) }))
  res.json({ list })
})

// GET /api/collections/:slug 公开合集详情（:slug 可为雪花 public_id 或历史 slug）
router.get('/collections/:slug', (req, res) => {
  const key = String(req.params.slug || '')
  const collection =
    db.prepare('SELECT * FROM collections WHERE public_id = ?').get(key) ||
    db.prepare('SELECT * FROM collections WHERE slug = ?').get(key)
  if (!collection) {
    return res.status(404).json({ message: '合集不存在' })
  }
  const posts = db
    .prepare(
      `SELECT ${POST_COLS_NO_CONTENT}
       ${POST_JOIN}
       WHERE p.collection_id = ? AND p.published = 1
       ORDER BY p.created_at DESC, p.id DESC`
    )
    .all(collection.id)
    .map(toPost)
  res.json({ ...collection, description: collection.description || '', posts })
})

// ---------- 管理接口（需登录） ----------

// GET /api/admin/posts 全部文章（含草稿），按更新时间倒序
router.get('/admin/posts', requireAuth, (req, res) => {
  const list = db
    .prepare(
      `SELECT ${POST_COLS}
       ${POST_JOIN}
       ORDER BY p.updated_at DESC, p.id DESC`
    )
    .all()
    .map(toPost)
  res.json({ list })
})

// GET /api/admin/posts/:id/preview-link 取该文章的「打开文章页」地址（需登录）
//   已发布 → 公开地址；草稿 → 附短时效预览令牌（默认 30 分钟，绑定 slug），
//   这样后台点标题能进文章页，而草稿对外仍是 404。
router.get('/admin/posts/:id/preview-link', requireAuth, (req, res) => {
  const post = db
    .prepare('SELECT id, slug, public_id, published FROM posts WHERE id = ?')
    .get(req.params.id)
  if (!post) {
    return res.status(404).json({ message: '文章不存在' })
  }
  // URL 用雪花 ID；老文章万一没回填成功则退回 slug，保证链接永远可用
  // 基址走 PUBLIC_SITE_URL（公共站点绝对地址）；未配置时回退相对路径
  const base = `${publicSiteUrl()}/blog/${post.public_id || post.slug}`
  const key = post.public_id || post.slug
  res.json({
    published: !!post.published,
    url: post.published ? base : `${base}?preview=${encodeURIComponent(signPreview(key))}`,
  })
})

// POST /api/admin/posts 新建文章
router.post('/admin/posts', requireAuth, (req, res) => {
  const { title, slug, content = '', excerpt = '', tags, published, collection_id } =
    req.body || {}

  // 标题必填
  if (!title || !title.trim()) {
    return res.status(400).json({ message: '标题不能为空' })
  }

  // tags 支持数组或逗号分隔字符串两种形式
  const tagList = Array.isArray(tags) ? tags : parseTags(tags)
  const publicId = nextId()
  const slugValue = uniqueSlug('posts', slugify(slug || title))
  const publishedValue = published ? 1 : 0
  const collectionId = parseCollectionId(collection_id) ?? null

  // collection_id 校验：指定但不存在时报错
  if (collectionId === null && collection_id !== undefined && collection_id !== null && collection_id !== '') {
    return res.status(400).json({ message: '合集不存在' })
  }

  const result = db
    .prepare(
      `INSERT INTO posts (title, slug, public_id, content, excerpt, tags, published, collection_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title.trim(),
      slugValue,
      publicId,
      content,
      excerpt.trim(),
      tagList.join(','),
      publishedValue,
      collectionId
    )

  // 更新标签统计
  rebuildTags()

  const post = db
    .prepare(`SELECT ${POST_COLS} ${POST_JOIN} WHERE p.id = ?`)
    .get(result.lastInsertRowid)
  res.status(201).json(toPost(post))
})

// PUT /api/admin/posts/:id 更新文章
router.put('/admin/posts/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id)
  if (!post) {
    return res.status(404).json({ message: '文章不存在' })
  }

  const { title, slug, content, excerpt, tags, published, collection_id } = req.body || {}
  const tagList = Array.isArray(tags) ? tags : parseTags(tags ?? post.tags)
  const publishedValue =
    published === undefined ? post.published : published ? 1 : 0
  // slug 只是内部别名：不显式给出就保持不变（改标题不再改别名、更不动 URL）
  const baseSlug = slug && String(slug).trim() ? slugify(slug) : post.slug || slugify(title || post.title)
  const slugValue = uniqueSlug('posts', baseSlug, id)

  // collection_id：undefined 表示不改动；null/'' 表示清除；否则校验存在性
  let collectionId = post.collection_id
  if (collection_id !== undefined) {
    collectionId = parseCollectionId(collection_id)
    if (collectionId === null && collection_id !== null && collection_id !== '') {
      return res.status(400).json({ message: '合集不存在' })
    }
  }

  db.prepare(
    `UPDATE posts
     SET title = ?, slug = ?, content = ?, excerpt = ?, tags = ?, published = ?,
         collection_id = ?, updated_at = datetime('now', 'localtime')
     WHERE id = ?`
  ).run(
    (title ?? post.title).trim(),
    slugValue,
    content ?? post.content,
    (excerpt ?? post.excerpt).trim(),
    tagList.join(','),
    publishedValue,
    collectionId,
    id
  )

  rebuildTags()

  const updated = db
    .prepare(`SELECT ${POST_COLS} ${POST_JOIN} WHERE p.id = ?`)
    .get(id)
  res.json(toPost(updated))
})

// DELETE /api/admin/posts/:id 删除文章
router.delete('/admin/posts/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const result = db.prepare('DELETE FROM posts WHERE id = ?').run(id)
  if (result.changes === 0) {
    return res.status(404).json({ message: '文章不存在' })
  }
  rebuildTags()
  res.json({ ok: true, message: '已删除' })
})

// ---------- 合集管理接口（需登录） ----------

// GET /api/admin/collections 全部合集（含草稿文章数）
router.get('/admin/collections', requireAuth, (req, res) => {
  const list = db
    .prepare(
      `SELECT c.id, c.name, c.slug, c.public_id, c.description, c.created_at,
              COUNT(p.id) AS post_count
       FROM collections c
       LEFT JOIN posts p ON p.collection_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at ASC, c.id ASC`
    )
    .all()
    .map((row) => ({ ...row, post_count: Number(row.post_count) }))
  res.json({ list })
})

// POST /api/admin/collections 新建合集
router.post('/admin/collections', requireAuth, (req, res) => {
  const { name, slug, description = '' } = req.body || {}

  // 名称必填
  if (!name || !name.trim()) {
    return res.status(400).json({ message: '合集名称不能为空' })
  }

  const slugValue = uniqueSlug('collections', slugify(slug || name, 'collection'))
  const publicId = nextId()

  const result = db
    .prepare('INSERT INTO collections (name, slug, public_id, description) VALUES (?, ?, ?, ?)')
    .run(name.trim(), slugValue, publicId, (description || '').trim())

  const collection = db
    .prepare('SELECT * FROM collections WHERE id = ?')
    .get(result.lastInsertRowid)
  res.status(201).json(collection)
})

// PUT /api/admin/collections/:id 更新合集
router.put('/admin/collections/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(id)
  if (!collection) {
    return res.status(404).json({ message: '合集不存在' })
  }

  const { name, slug, description } = req.body || {}
  // slug 仅内部别名：不显式给出就保持不变
  const baseSlug =
    slug && String(slug).trim()
      ? slugify(slug, 'collection')
      : collection.slug || slugify(name || collection.name, 'collection')
  const slugValue = uniqueSlug('collections', baseSlug, id)

  db.prepare(
    `UPDATE collections
     SET name = ?, slug = ?, description = ?
     WHERE id = ?`
  ).run(
    (name ?? collection.name).trim(),
    slugValue,
    (description ?? collection.description ?? '').trim(),
    id
  )

  const updated = db.prepare('SELECT * FROM collections WHERE id = ?').get(id)
  res.json(updated)
})

// DELETE /api/admin/collections/:id 删除合集（文章 collection_id 置 NULL）
router.delete('/admin/collections/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const collection = db.prepare('SELECT id FROM collections WHERE id = ?').get(id)
  if (!collection) {
    return res.status(404).json({ message: '合集不存在' })
  }

  // 显式解除关联（外键 ON DELETE SET NULL 兜底，双保险）
  db.prepare('UPDATE posts SET collection_id = NULL WHERE collection_id = ?').run(id)
  db.prepare('DELETE FROM collections WHERE id = ?').run(id)
  res.json({ ok: true, message: '已删除' })
})

module.exports = router
