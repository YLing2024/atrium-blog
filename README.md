# atrium-blog

个人博客的后端 API：给自建博客前台与后台提供文章、合集与图片接口。

## 它能做什么

- 文章的增删改查、分页列表与按标签筛选，草稿与已发布状态分开。
- 文章对外标识使用**雪花 ID 字符串**（`public_id`，19 位数字，时间有序、不可枚举）；`slug` 退化为内部别名，仅用于兼容旧链接。
- 详情与合集接口按 `public_id` 查找，找不到时回退 `slug`，因此老地址仍然可用。
- `title`（标题）、`subtitle`（副标题，独立字段，上限 200 字符）、`excerpt`（摘要）语义分离，互不复用。
- 合集（collections）可与文章多对一关联，删除合集时文章自动解除关联。
- 图片上传，限制 10MB，文件落在 `server/uploads/`，公开读取走 `/api/blog/uploads/:name`。
- 草稿预览：为登录用户生成绑定文章的短时效预览链接，草稿对匿名访问者仍是 404。
- 管理端两种认证模式：自带账号口令（`builtin`）或只信任前置认证注入的 `X-Auth-User`（`sso`）。

> `web/` 与 `admin/` 是历史遗留的旧前端，已停用、不随本服务部署；本仓库实际维护的是 `server/`。

## 快速开始

需要 Node 24（`better-sqlite3` 为原生模块，升级 Node 主版本后需重新编译）。

```bash
cd server
npm install
npm run dev     # node --watch src/index.js
npm start       # node src/index.js
```

首次启动会自动建库建表并写入示例文章，同时打印一行初始管理员账号口令，**只打印一次**，请立即保存。
想自己指定，就在首次启动前设置 `BLOG_ADMIN_USER` 与 `BLOG_ADMIN_PASSWORD`。

## 接口一览（前缀 `/api/blog`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/posts` | 无 | 已发布文章列表，`?page=&tag=`，每页 10 条，不返回正文 |
| GET | `/posts/:key` | 可选 | 详情；`key` 优先按 `public_id`，回退 `slug`；草稿需登录态或 `?preview=` |
| GET | `/collections` | 无 | 合集列表，含已发布文章数 |
| GET | `/collections/:key` | 无 | 合集详情，含其下已发布文章 |
| GET | `/uploads/:name` | 无 | 图片 |
| GET | `/auth-mode` | 无 | 当前认证模式 `{ authMode }` |
| POST | `/admin/login` | 无 | 登录，返回 JWT 并下发会话 cookie（`sso` 下 404） |
| POST | `/admin/logout` | 无 | 退出，幂等（`sso` 下 404） |
| GET | `/admin/me` | 需要 | 当前身份 `{ name, role }`（`sso` 下 404） |
| GET/POST | `/admin/posts` | 需要 | 全部文章（含草稿）/ 新建 |
| PUT/DELETE | `/admin/posts/:id` | 需要 | 更新 / 删除 |
| GET | `/admin/posts/:id/preview-link` | 需要 | 生成文章页地址，草稿附加短时效预览令牌 |
| GET/POST | `/admin/collections` | 需要 | 全部合集 / 新建 |
| PUT/DELETE | `/admin/collections/:id` | 需要 | 更新 / 删除 |
| POST | `/admin/upload` | 需要 | 上传图片，字段名 `image` |

管理接口里的 `:id` 是数据库自增整数 id，不是雪花 ID；文章的对外标识始终是 `public_id`。

## 配置

复制 `server/.env.example` 为 `server/.env`，按需修改。代码里真实读取的键：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTH_MODE` | `builtin` | 管理端认证模式；未设置或非法值一律回退 `builtin` |
| `PORT` | `4000` | 监听端口 |
| `JWT_SECRET` | `dev-secret` | JWT 签名密钥，生产必须显式设置 |
| `DB_PATH` | `server/data/blog.db` | SQLite 文件路径 |
| `ADMIN_REDIS_URL` | `redis://127.0.0.1:6379` | 会话校验用的 Redis |
| `ADMIN_REDIS_PREFIX` | `admin:session:` | 会话 key 前缀，支持逗号分隔多前缀 |
| `PREVIEW_TTL` | `30m` | 草稿预览令牌有效期 |
| `PUBLIC_SITE_URL` | 空 | 博客前台基址（含协议）；preview-link 用它拼绝对地址，未配置时回退相对路径并打 warn |
| `SNOWFLAKE_WORKER_ID` | `0` | 多实例部署时区分雪花 ID 机器号 |
| `BLOG_ADMIN_USER` | `admin` | 首次启动创建管理员时的用户名 |
| `BLOG_ADMIN_PASSWORD` | 随机 16 位 | 首次启动创建管理员时的口令；未设置则随机并只打印一次 |

## 数据与迁移

- SQLite 使用 `better-sqlite3`，开启 WAL 与 `foreign_keys`，表为 `collections` / `users` / `posts` / `tags`。
- 没有独立迁移框架：启动时按 `PRAGMA table_info` 检测缺失列，用 `ALTER TABLE` 幂等补齐（`collection_id`、`subtitle`、`public_id`），并为历史数据回填 `public_id` 后建唯一索引。
- `server/data/`（含 `-wal` / `-shm`）与 `server/uploads/` 不入库，备份时需一并考虑。

## 部署

- systemd 单元：`blog-server.service`。
- 服务只监听 `127.0.0.1:4000`，由 nginx 反代对外；无构建产物，直接运行 `src/index.js`。
- nginx 层：`/api/blog/*` 公开读放行；`/api/blog/admin/*` 交给认证网关。
- 经认证网关部署时须显式设置 `AUTH_MODE=sso`，否则网关注入的 `X-Auth-User` 会被 `builtin` 忽略，管理接口不可用。

## 认证与安全

- `builtin`（默认）：`bcrypt` 用户名口令登录，成功后返回 JWT 并下发 HttpOnly 会话 cookie `admin_session`（`Path=/; SameSite=Lax`，HTTPS 下加 `Secure`）。鉴权接受 `Authorization: Bearer` 或该 cookie，先校验 JWT，再校验 Redis 会话；此模式下 `X-Auth-User` 被忽略，不因外部头提权。
- `sso`：关闭自带口令，只认认证网关注入的 `X-Auth-User`，缺失即为 401；`admin/login|logout|me` 返回 404。
- 服务绑定 `127.0.0.1`，杜绝公网直连伪造 `X-Auth-User` 绕过网关。
- 上传限制 10MB 大小（未做 MIME 类型校验）；读取图片时文件名取 basename，禁止路径越出 `uploads/`。

## 许可证

MIT，见 `LICENSE`。
