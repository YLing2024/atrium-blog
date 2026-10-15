# AGENTS.md — blog（博客系统 monorepo）

> 维护本仓库前先读本文件。README.md 是面向用户的介绍；冲突时以本文件为准。

## 这个项目是什么

个人博客系统。**monorepo 三子项目，但只有一个在生产跑**：

| 目录 | 技术 | 状态 |
|---|---|---|
| `server` | Node + Express 4 + SQLite | ✅ **生产**（`blog-server.service`，`127.0.0.1:4000`） |
| `web` | Vite + React 博客前台 | ⛔ **已停用**，别改（生产前台是 `../homepage`） |
| `admin` | Vite + React 管理后台 | ⛔ **已停用**，别改（生产后台是 `../admin-web` 的 BlogAdmin Tab） |

再强调一次：**前台在 `../homepage`，后台在 `../admin-web`，本仓库只有 `server/` 是活的。**

## 技术栈（server）

- Node 24，Express 4，CommonJS
- **better-sqlite3 13.x**（注意：这是原生模块，Node 大版本升级后必须重装/重编译；曾因 11.x 在 Node 24 上原生崩溃而升到 13.0.3）
- `jsonwebtoken`（本地兼容通道：管理接口 JWT）、`ioredis`（本地兼容通道：admin 会话）、`multer`（图片上传）
  —— 生产管理接口主鉴权已由 Auth Gateway 负责（网关注入 `X-Auth-User`），这两条通道保留兼容
- **雪花 ID**（`src/snowflake.ts`）：文章/合集对外标识用 19 位字符串 ID，防枚举、时间有序

## 目录结构（server）

```
server/
├── src/
│   ├── index.ts        # 入口，挂载 /api/blog，监听 127.0.0.1:4000
│   ├── db.ts           # SQLite 初始化 + 建表（collections / users / posts / tags）
│   ├── auth.ts         # JWT 签发/校验 + Redis admin 会话第二通道
│   ├── snowflake.ts    # 雪花 ID（返回字符串，防止 Number 精度丢失）
│   └── routes/
│       ├── auth.ts     # POST /admin/login
│       └── posts.ts    # 公开读 + 管理写（CRUD、合集、上传、预览链接）
├── data/blog.db        # SQLite（+ -wal/-shm），不入库
└── uploads/            # 上传图片，不入库
```

## 接口一览（前缀 `/api/blog`）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/posts` | 无 | 文章列表（分页、按标签/合集筛选） |
| GET | `/posts/:slug` | 可选 | 详情；参数实际是**雪花 ID**，老文章回退 slug |
| GET | `/collections` `/collections/:slug` | 无 | 合集 |
| GET | `/uploads/:name` | 无 | 图片 |
| POST | `/admin/login` | 无 | 管理员登录 |
| GET/POST/PUT/DELETE | `/admin/posts[/:id]` | ✅ | 文章 CRUD |
| GET | `/admin/posts/:id/preview-link` | ✅ | 生成草稿短时效预览链接（`PREVIEW_TTL`） |
| GET/POST/PUT/DELETE | `/admin/collections[/:id]` | ✅ | 合集 CRUD |
| POST | `/admin/upload` | ✅ | 图片上传 |

## 鉴权

认证模式由环境变量 `AUTH_MODE` 决定，**未设置 / 非法值一律回退 `builtin`（仓库 public，默认必须是自带账号）**；启动时 stdout 打印一行 `管理端认证模式: …`。

1. **`builtin`（默认）**：自带账号体系完整可用——`bcrypt` 用户名+口令登录（`POST /api/blog/admin/login`）后同时返回 JWT 字段并下发 HttpOnly 会话 cookie `admin_session`（`Path=/; HttpOnly; SameSite=Lax`，HTTPS 下加 `Secure`，`Max-Age` = 会话 TTL）。`requireAuth` 接受 `Authorization: Bearer <token>` 或 cookie `admin_session`，校验 blog JWT 或 Redis `admin:session:<token>`（沿用多前缀支持）。此模式下 `X-Auth-User` 被**忽略**，不因外部头提权。
2. **`sso`**：关掉自带口令，`requireAuth` **只认** Auth Gateway 注入的 `X-Auth-User`（缺失/空 → `401 JSON`）；**禁止**解析 cookie/JWT/上游凭证，禁止自行实现 OIDC 跳转。`admin/login|logout|me` 一律 `404`。
3. 两条兼容通道（blog JWT 与 Redis admin 会话）在两种模式下代码都保留，但仅作为 `builtin` 的凭证来源；`sso` 不因它们的缺失而拒绝请求。
4. 新增免鉴权接口 `GET /api/blog/auth-mode` → `200 {"authMode":"builtin"|"sso"}`，不含其它信息；`POST /api/blog/admin/logout`（删会话+清 cookie，幂等）、`GET /api/blog/admin/me` → `{name, role}`（未登录 `401`）。
5. 公开读接口（`/api/blog/posts`、`/collections`、`/uploads/:name`）任何时候都不加鉴权。
6. nginx 层：`/api/blog/*` 公开读放行；`/api/blog/admin/*` 交给 Auth Gateway 鉴权。配置里**不再有** `auth_request` / 探针。生产实例须在 `.env` 显式 `AUTH_MODE=sso`，否则网关注入的头会被 builtin 忽略、管理接口不可用。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `AUTH_MODE` | `builtin` | 管理端认证模式；`builtin`（自带账号）/ `sso`（只认 `X-Auth-User`）；非法值回退 `builtin` |
| `PORT` | `4000` | systemd 设置 |
| `JWT_SECRET` | `dev-secret` | 生产必须显式设置 |
| `DB_PATH` | `server/data/blog.db` | SQLite 文件 |
| `ADMIN_REDIS_URL` / `ADMIN_REDIS_PREFIX` | `redis://127.0.0.1:6379` / `admin:session:` | 支持逗号分隔多前缀（正式+测试） |
| `PREVIEW_TTL` | 见代码 | 草稿预览链接有效期 |
| `PUBLIC_SITE_URL` | 空（回退相对路径并 warn） | 公共站点基址（含协议）；preview-link 用它拼绝对地址，未配置时回退相对路径 |
| `SNOWFLAKE_WORKER_ID` | `0` | 多实例部署时才需区分 |

## 命令

```bash
cd server
npm install
npm start          # node src/index.ts（Node 原生类型剥离，零构建）
npm run dev        # node --watch

systemctl restart blog-server
journalctl -u blog-server -n 100 --no-pager
```

校验：`npm run typecheck`（`tsc --noEmit`）、`npm run lint`（ESLint 正确性规则）、`npm test`（Node 内置 `node:test`，零框架）；`npm run check` 三者串跑。**无需构建步骤**——Node 24 原生剥离类型，直接 `node src/index.ts`（`web/`、`admin/` 是已停用的旧前端，不参与）。

## 数据与 ID 约定

- 对外标识统一用**雪花 ID 字符串**（`posts.public_id` / `collections.public_id`）；前端链接形如 `/blog/<19 位数字>`。
- 雪花 ID 必须是**字符串**贯穿全链路——19 位超出 `Number.MAX_SAFE_INTEGER`，任何一处转 Number 都会丢精度。
- 时钟回拨时算法沿用上次时间戳（宁可慢一拍也不产生重复），不要"优化"掉这段。

## 文章字段与正文约定（强约束）

- 三个文本字段语义**不可混用**：`title` 标题（详情页唯一 h1）、`subtitle` 副标题（**独立字段**，留空即不显示）、`excerpt` 摘要（列表/SEO 用，**不是**副标题）。
- 正文（`content`，Markdown）**不得使用 `#` 一级标题**：h1 只属于页面标题，章节一律 `##`。历史文章的 h1 已用一次性治理脚本迁移（开头且与标题重复的删除，其余降级 h2），脚本幂等可重跑。
- 前端另有兜底：渲染时把正文 `h1` 一律降级为 `h2`。
- **禁止**"前台从正文里猜副标题"这类隐式推断（曾实现过，已被否决）。

## 安全红线

- `JWT_SECRET` 默认值 `dev-secret` 只用于本地；**生产必须由环境变量注入**。
- `server/data/`（含 `blog.db`）与 `server/uploads/` 不入库；`.gitignore` 已覆盖 `*.db`。
- 不要把域名、IP 等私有地址写进源码。
- 上传必须限制类型/大小，路径不得越出 `uploads/`。

## 已知坑

- **改 `web/` 或 `admin/` 是白费功夫**：它们不部署，改了也不会出现在线上；线上前台/后台分别在 `homepage` 和 `admin-web`。
- better-sqlite3 是原生模块：升级 Node 主版本后若报 ABI/segfault，重新 `npm rebuild better-sqlite3` 或对齐版本。
- SQLite 用 WAL 模式，备份要连 `-wal`/`-shm` 一起考虑（或用 `.backup`）。
- 管理接口的鉴权顺序：Auth Gateway 注入的 `X-Auth-User` 优先；不要让本地 JWT 校验把网关路径拦掉。
- **后台在独立子域，任何指向公共站点（博客前台）的链接都必须是绝对地址，基址走 `PUBLIC_SITE_URL` 可配置，不得写死域名。** 相对路径 `/blog/<id>` 在子域后台会被当成后台自身路径打开，落到后台 SPA（打不开文章）。`admin-server` 的分享链接 `shareBaseUrl()` 按 `x-forwarded-host` 推导是另一套、正确的设计，别去"统一"它。

