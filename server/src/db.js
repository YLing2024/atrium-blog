// db.js —— SQLite 数据库初始化与种子数据
// 使用 better-sqlite3，数据库文件默认存放在 server/data/blog.db
// 首次启动自动建表（users / posts / tags），并插入默认管理员账号与 3 篇示例文章

const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')

// 数据库文件路径，可通过环境变量 DB_PATH 覆盖
const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'blog.db')

// 确保数据库所在目录存在
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

// 打开数据库（better-sqlite3 是同步 API）
const db = new Database(DB_PATH)

// 基础配置：WAL 提升并发读写性能；开启外键约束
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ---------- 建表 ----------
db.exec(`
  -- 管理员用户表：password 存储 bcrypt 哈希
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 文章表：tags 以逗号分隔的字符串存储
  CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    content    TEXT NOT NULL DEFAULT '',
    excerpt    TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '',
    published  INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 标签表：只做统计与展示，数据来源以 posts.tags 为准
  CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    post_count INTEGER NOT NULL DEFAULT 0
  );
`)

// ---------- 标签辅助函数 ----------

// 把逗号分隔的标签字符串解析成数组（自动去空与去重）
function parseTags(tags = '') {
  const seen = new Set()
  return String(tags)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !seen.has(t) && seen.add(t))
}

// 根据 posts 表的数据重建 tags 表（增删改文章后调用，简单可靠）
function rebuildTags() {
  const rows = db.prepare('SELECT tags FROM posts').all()
  const counter = {}
  for (const row of rows) {
    for (const name of parseTags(row.tags)) {
      counter[name] = (counter[name] || 0) + 1
    }
  }
  const del = db.prepare('DELETE FROM tags')
  const insert = db.prepare('INSERT INTO tags (name, post_count) VALUES (?, ?)')
  db.transaction(() => {
    del.run()
    for (const [name, count] of Object.entries(counter)) {
      insert.run(name, count)
    }
  })()
}

// 查询所有标签及对应的文章数量（按文章数降序）
function listTags() {
  return db
    .prepare('SELECT name, post_count FROM tags ORDER BY post_count DESC, name ASC')
    .all()
}

// ---------- 种子数据 ----------

// 如果没有管理员账号，则创建默认账号 admin / admin123
function seedUsers() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get()
  if (n > 0) return
  const hash = bcrypt.hashSync('admin123', 10)
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hash)
  console.log('[db] 已创建默认管理员账号：admin / admin123')
}

// 示例文章（首次启动时插入）
const SAMPLE_POSTS = [
  {
    title: '你好，世界：博客正式上线',
    slug: 'hello-world',
    excerpt: '这是博客的第一篇文章，记录这个站点搭建的初衷、设计理念与使用方式。',
    tags: '随笔, 博客',
    published: 1,
    content: `## 欢迎来到我的博客

这里是博客的第一篇文章。从今天开始，我会在这里记录技术笔记、读书心得与生活随笔。

### 为什么搭建这个博客

我希望有一个完全属于自己的空间：没有广告、没有推荐算法，只有文字本身。

### 这个站点的设计理念

- 极简、安静、干净
- 黑白灰为主，少量琥珀色点缀
- 不加载任何 Web 字体，保持加载速度
- 深色模式跟随系统自动切换

一段示例代码：

\`\`\`js
console.log('Hello, World!')
\`\`\`

> 少即是多。
>
> —— 好的工具应该让人专注于内容本身。`,
  },
  {
    title: '为什么用 Markdown 写博客',
    slug: 'why-markdown',
    excerpt: '正文与样式分离、对版本控制友好、让人专注写作。聊聊我选择 Markdown 的几个理由。',
    tags: 'Markdown, 写作',
    published: 1,
    content: `## 为什么用 Markdown 写博客

在尝试过各种富文本编辑器之后，我最终选择了 Markdown。原因很简单：

### 1. 专注内容

Markdown 语法足够轻量，写作时不用关心排版，眼睛只盯着文字本身。

### 2. 纯文本，可版本化

Markdown 文件就是纯文本，可以直接放进 Git 仓库，每一次修改都有记录。

### 3. 随处可用

支持 Markdown 的工具无处不在，写好的内容可以轻易迁移到别的平台。

### 常用语法速览

| 语法        | 效果        |
| ----------- | ----------- |
| \`**加粗**\` | **加粗**    |
| \`*斜体*\`   | *斜体*      |
| \`[链接](url)\` | [链接](url) |

> 写作的本质是思考，工具越简单越好。`,
  },
  {
    title: '前端性能优化笔记',
    slug: 'frontend-performance-notes',
    excerpt: '从网络、渲染与代码三个层面，整理常见的前端性能优化手段，供日常开发查阅。',
    tags: '前端, 性能优化',
    published: 1,
    content: `## 前端性能优化笔记

性能优化的本质是**减少关键路径上的工作量**。下面按三个层面整理常用的手段。

### 网络层面

- 启用 HTTP/2 与 CDN，减少往返时延
- 静态资源开启 Gzip / Brotli 压缩
- 图片使用 WebP / AVIF 格式并懒加载
- 合理设置缓存策略

\`\`\`js
// 懒加载图片的简单写法
const img = document.querySelector('img[data-src]')
img.addEventListener('load', () => {
  img.src = img.dataset.src
})
\`\`\`

### 渲染层面

- 避免阻塞渲染的脚本，使用 \`defer\` / \`async\`
- 用 CSS 动画替代 JS 动画
- 减少重排与重绘，合理使用 \`will-change\`

### 代码层面

- 组件与路由按需加载
- 长列表使用虚拟滚动
- 缓存计算结果，避免重复运算

> 优化要基于数据，先测量再动手。`,
  },
]

// 如果文章表为空，则插入示例文章
function seedPosts() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM posts').get()
  if (n > 0) return
  const insert = db.prepare(
    `INSERT INTO posts (title, slug, content, excerpt, tags, published)
     VALUES (@title, @slug, @content, @excerpt, @tags, @published)`
  )
  db.transaction(() => {
    for (const post of SAMPLE_POSTS) insert.run(post)
  })()
  console.log('[db] 已插入 3 篇示例文章')
}

// 初始化：建表后依次写入种子数据并重建标签
seedUsers()
seedPosts()
rebuildTags()

// 导出数据库连接与工具函数
module.exports = { db, parseTags, rebuildTags, listTags }
