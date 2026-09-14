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
- `jsonwebtoken`（管理接口主鉴权）、`ioredis`（第二通道：admin 会话）、`multer`（图片上传）
- **雪花 ID**（`src/snowflake.js`）：文章/合集对外标识用 19 位字符串 ID，防枚举、时间有序

## 目录结构（server）

```
server/
├── src/
│   ├── index.js        # 入口，挂载 /api/blog，监听 127.0.0.1:4000
│   ├── db.js           # SQLite 初始化 + 建表（collections / users / posts / tags）
│   ├── auth.js         # JWT 签发/校验 + Redis admin 会话第二通道
│   ├── snowflake.js    # 雪花 ID（返回字符串，防止 Number 精度丢失）
│   └── routes/
│       ├── auth.js     # POST /admin/login
│       └── posts.js    # 公开读 + 管理写（CRUD、合集、上传、预览链接）
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

## 鉴权（双通道）

1. **JWT**（主通道）：`JWT_SECRET` 签发，7 天有效；生产由 nginx 探针 + `X-Auth-User` 覆盖大部分路径。
2. **Redis admin 会话**（第二通道）：`admin:session:<token>`，12h 滑动续期，与 admin-server 共 key 空间；Redis 挂了不影响 JWT 通道（代码里显式忽略连接错误）。
3. nginx 层：`/api/blog/admin/*` 走 SSO 探针鉴权；`/api/blog/*` 公开读放行。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `4000` | systemd 设置 |
| `JWT_SECRET` | `dev-secret` | 生产必须显式设置 |
| `DB_PATH` | `server/data/blog.db` | SQLite 文件 |
| `ADMIN_REDIS_URL` / `ADMIN_REDIS_PREFIX` | `redis://127.0.0.1:6379` / `admin:session:` | 支持逗号分隔多前缀（正式+测试） |
| `PREVIEW_TTL` | 见代码 | 草稿预览链接有效期 |
| `SNOWFLAKE_WORKER_ID` | `0` | 多实例部署时才需区分 |

## 命令

```bash
cd server
npm install
npm start          # node src/index.js
npm run dev        # node --watch

systemctl restart blog-server
journalctl -u blog-server -n 100 --no-pager
```

无测试、无 lint、无构建步骤（`web/`、`admin/` 各自有 `npm run dev/build`，但它们是停用的）。

## 数据与 ID 约定

- 对外标识统一用**雪花 ID 字符串**（`posts.public_id` / `collections.public_id`）；前端链接形如 `/blog/<19 位数字>`。
- 雪花 ID 必须是**字符串**贯穿全链路——19 位超出 `Number.MAX_SAFE_INTEGER`，任何一处转 Number 都会丢精度。
- 时钟回拨时算法沿用上次时间戳（宁可慢一拍也不产生重复），不要"优化"掉这段。

## 安全红线

- `JWT_SECRET` 默认值 `dev-secret` 只用于本地；**生产必须由环境变量注入**。
- `server/data/`（含 `blog.db`）与 `server/uploads/` 不入库；`.gitignore` 已覆盖 `*.db`。
- 不要把域名、IP 等私有地址写进源码。
- 上传必须限制类型/大小，路径不得越出 `uploads/`。

## 已知坑

- **改 `web/` 或 `admin/` 是白费功夫**：它们不部署，改了也不会出现在线上；线上前台/后台分别在 `homepage` 和 `admin-web`。
- better-sqlite3 是原生模块：升级 Node 主版本后若报 ABI/segfault，重新 `npm rebuild better-sqlite3` 或对齐版本。
- SQLite 用 WAL 模式，备份要连 `-wal`/`-shm` 一起考虑（或用 `.backup`）。
- 管理接口的鉴权顺序：nginx 探针注入的 `X-Auth-User` 优先；不要让本地 JWT 校验把探针路径拦掉。

## 项目记忆（PROJECT_MEMORY.md）

`PROJECT_MEMORY.md` 用于保存可演进的项目记忆；`AGENTS.md` 保持为稳定的硬规则。处理非简单任务，或任务涉及既有业务判断、API 参数与雪花 ID 约定、历史 bug、产品/UI 习惯时，先按关键词查阅 `PROJECT_MEMORY.md`。

- Agent 可以**自迭代** `PROJECT_MEMORY.md`：当前任务中确认了可复用、长期有效的项目经验后，应追加或更新对应条目。
- 每条记忆必须写明日期、适用范围和可追溯证据（源码路径/行号、调用方（homepage / admin-web）字段对照、提交或验证结果）；可能过期的结论须标明复核条件。
- 不记录临时猜测、单次偶发现象、未经验证的产品判断、敏感信息或与项目无关的个人偏好。
- `PROJECT_MEMORY.md` 与 `AGENTS.md` 冲突时，以 `AGENTS.md` 为准；只有经明确确认的、长期稳定且必须遵守的规则，才能由用户决定升级到 `AGENTS.md`。
- 本文件已在 `.gitignore` 中忽略：**只存本机，不提交、不推送**。
