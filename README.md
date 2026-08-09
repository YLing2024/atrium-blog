# Blog 博客系统（monorepo）

一个极简风格的博客系统，采用 monorepo 结构，包含三个子项目：

| 目录     | 说明                            | 默认地址               |
| -------- | ------------------------------- | ---------------------- |
| `server` | 后端 API（Node.js + Express + SQLite） | http://localhost:4000  |
| `web`    | 博客前台（Vite + React）        | http://localhost:5173  |
| `admin`  | 管理后台（Vite + React）        | http://localhost:5174  |

## 目录结构

```
blog/
├── README.md            # 本文件
├── server/              # 后端 API 服务
│   ├── package.json
│   └── src/
│       ├── index.js     # 入口，监听 4000 端口
│       ├── db.js        # SQLite 初始化（建表 posts / tags / users + 种子数据）
│       ├── auth.js      # JWT 签名 / 校验 / 鉴权中间件
│       └── routes/
│           ├── posts.js # 文章 CRUD、分页、按标签筛选、公开 / 管理双接口
│           └── auth.js  # 管理员登录接口
├── web/                 # 博客前台
│   ├── package.json
│   ├── vite.config.js   # dev 时 /api 代理到 4000
│   └── src/
│       ├── main.jsx
│       ├── App.jsx      # 路由：文章列表 / 文章详情
│       ├── api.js       # fetch 封装
│       ├── styles.css   # 全局样式（极简风 + 深色模式）
│       └── pages/
│           ├── List.jsx # 文章列表
│           └── Post.jsx # 文章详情（Markdown 渲染）
└── admin/               # 管理后台
    ├── package.json
    ├── vite.config.js   # dev 时 /api 代理到 4000
    └── src/
        ├── main.jsx
        ├── App.jsx      # 路由：登录 / 文章管理列表 / 编辑页
        ├── api.js       # 带 token 的 fetch 封装
        ├── styles.css
        └── pages/
            ├── Login.jsx     # 登录
            ├── AdminList.jsx # 文章管理列表
            └── Editor.jsx    # 新建 / 编辑文章
```

## 启动方式

需要 Node.js 18+。三个子项目分别安装依赖、分别启动：

```bash
# 1. 后端 API（首次启动自动建表并插入种子数据）
cd server
npm install
npm run dev        # http://localhost:4000

# 2. 博客前台
cd ../web
npm install
npm run dev        # http://localhost:5173

# 3. 管理后台
cd ../admin
npm install
npm run dev        # http://localhost:5174
```

前台与管理后台在开发模式下会把 `/api` 请求代理到后端的 `4000` 端口，三个终端同时运行时即可联调。

## 默认账号

| 项目 | 账号  | 密码     |
| ---- | ----- | -------- |
| 后台 | admin | admin123 |

首次启动时后端会自动创建该管理员账号，密码使用 bcrypt 哈希存储。

## 接口说明

| 方法   | 路径                 | 鉴权   | 说明                         |
| ------ | -------------------- | ------ | ---------------------------- |
| GET    | `/api/posts`         | 公开   | 已发布文章列表，支持 `?page=&tag=` |
| GET    | `/api/posts/:slug`   | 公开   | 已发布文章详情               |
| POST   | `/api/admin/login`   | 公开   | 管理员登录，返回 JWT         |
| GET    | `/api/admin/posts`   | 需要   | 全部文章（含草稿）           |
| POST   | `/api/admin/posts`   | 需要   | 新建文章                     |
| PUT    | `/api/admin/posts/:id` | 需要 | 更新文章                     |
| DELETE | `/api/admin/posts/:id` | 需要 | 删除文章                     |

## 环境变量

| 变量        | 默认值       | 说明                 |
| ----------- | ------------ | -------------------- |
| `JWT_SECRET`| `dev-secret` | JWT 签名密钥         |
| `DB_PATH`   | `server/data/blog.db` | SQLite 数据库文件路径 |
| `PORT`      | `4000`       | 后端服务端口         |

## 技术栈

- **server**：Express 4、better-sqlite3、bcryptjs、jsonwebtoken
- **web**：Vite 5、React 18、react-router-dom 6、marked（Markdown 渲染）
- **admin**：Vite 5、React 18、react-router-dom 6

前台与管理后台均采用黑白灰 + 琥珀色点缀的极简风格，使用系统字体栈（不加载任何 Web Font），深色模式跟随系统 `prefers-color-scheme` 自动切换。
