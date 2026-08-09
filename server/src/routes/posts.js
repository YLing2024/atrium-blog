// routes/posts.js —— 文章相关路由
// 公开接口（无需鉴权）：
//   GET /api/posts          文章列表（仅已发布，支持 ?page= & tag=）
//   GET /api/posts/:slug    文章详情（仅已发布）
// 管理接口（需鉴权 requireAuth）：
//   GET    /api/admin/posts        全部文章（含草稿）
//   POST   /api/admin/posts        新建文章
//   PUT    /api/admin/posts/:id    更新文章
//   DELETE /api/admin/posts/:id    删除文章

const express = require('express')
const { db, parseTags, rebuildTags } = require('../db')
const { requireAuth } = require('../auth')

const router = express.Router()

// 列表每页条数
const PAGE_SIZE = 10

// ---------- 工具函数 ----------

// 生成 slug：转小写、空格转短横线、过滤非法字符
// 中文标题无法生成可用 slug 时，退回 post-<时间戳> 形式
function slugify(text) {
  const slug = String(text || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '')
    .replace(/^-+|-+$/g, '')
  return slug || `post-${Date.now()}`
}

// 把数据库行整理成对外结构：published 转布尔、tags 转数组
function toPost(row) {
  if (!row) return null
  return {
    ...row,
    published: !!row.published,
    tags: parseTags(row.tags),
  }
}

// 对 LIKE 通配符做转义，防止标签名被误当通配符
function escapeLike(str) {
  return String(str).replace(/[\\%_]/g, (c) => `\\${c}`)
}

// ---------- 公开接口 ----------

// GET /api/posts 公开文章列表：仅 published=1，支持 ?page=&tag=
router.get('/posts', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const tag = String(req.query.tag || '').trim()

  // 动态拼接筛选条件
  const conditions = ['published = 1']
  const params = []
  if (tag) {
    // 用 "," + tags + "," 包起来做匹配，避免"前端"误匹配"前后端"
    conditions.push("(',' || tags || ',') LIKE ? ESCAPE '\\'")
    params.push(`%,${escapeLike(tag)},%`)
  }
  const where = conditions.join(' AND ')

  // 总数与总页数
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM posts WHERE ${where}`)
    .get(...params).n
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)

  // 分页查询（列表接口不返回正文，减小传输量）
  const list = db
    .prepare(
      `SELECT id, title, slug, excerpt, tags, created_at, updated_at
       FROM posts
       WHERE ${where}
       ORDER BY created_at DESC, id DESC
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

// GET /api/posts/:slug 公开文章详情（仅已发布）
router.get('/posts/:slug', (req, res) => {
  const post = db
    .prepare('SELECT * FROM posts WHERE slug = ? AND published = 1')
    .get(req.params.slug)
  if (!post) {
    return res.status(404).json({ message: '文章不存在或未发布' })
  }
  res.json(toPost(post))
})

// ---------- 管理接口（需登录） ----------

// GET /api/admin/posts 全部文章（含草稿），按更新时间倒序
router.get('/admin/posts', requireAuth, (req, res) => {
  const list = db
    .prepare('SELECT * FROM posts ORDER BY updated_at DESC, id DESC')
    .all()
    .map(toPost)
  res.json({ list })
})

// POST /api/admin/posts 新建文章
router.post('/admin/posts', requireAuth, (req, res) => {
  const { title, slug, content = '', excerpt = '', tags, published } = req.body || {}

  // 标题必填
  if (!title || !title.trim()) {
    return res.status(400).json({ message: '标题不能为空' })
  }

  // tags 支持数组或逗号分隔字符串两种形式
  const tagList = Array.isArray(tags) ? tags : parseTags(tags)
  const slugValue = slugify(slug || title)
  const publishedValue = published ? 1 : 0

  // slug 唯一性检查
  const exists = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slugValue)
  if (exists) {
    return res.status(409).json({ message: `slug「${slugValue}」已存在，请更换` })
  }

  const result = db
    .prepare(
      `INSERT INTO posts (title, slug, content, excerpt, tags, published)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(title.trim(), slugValue, content, excerpt.trim(), tagList.join(','), publishedValue)

  // 更新标签统计
  rebuildTags()

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid)
  res.status(201).json(toPost(post))
})

// PUT /api/admin/posts/:id 更新文章
router.put('/admin/posts/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id)
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id)
  if (!post) {
    return res.status(404).json({ message: '文章不存在' })
  }

  const { title, slug, content, excerpt, tags, published } = req.body || {}
  const tagList = Array.isArray(tags) ? tags : parseTags(tags ?? post.tags)
  const publishedValue =
    published === undefined ? post.published : published ? 1 : 0
  const slugValue = slugify(slug || title || post.slug)

  // slug 唯一性检查（排除自身）
  const dup = db
    .prepare('SELECT id FROM posts WHERE slug = ? AND id != ?')
    .get(slugValue, id)
  if (dup) {
    return res.status(409).json({ message: `slug「${slugValue}」已存在，请更换` })
  }

  db.prepare(
    `UPDATE posts
     SET title = ?, slug = ?, content = ?, excerpt = ?, tags = ?, published = ?,
         updated_at = datetime('now', 'localtime')
     WHERE id = ?`
  ).run(
    (title ?? post.title).trim(),
    slugValue,
    content ?? post.content,
    (excerpt ?? post.excerpt).trim(),
    tagList.join(','),
    publishedValue,
    id
  )

  rebuildTags()

  const updated = db.prepare('SELECT * FROM posts WHERE id = ?').get(id)
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

module.exports = router
