[English](README.en.md) | [简体中文](README.md)

# atrium-blog

The backend API for a personal blog: it serves post, collection and image APIs to the self-hosted blog frontend and admin.

## What it does

- Create, read, update and delete posts, paginated lists and tag filtering; drafts and published posts are kept separate.
- Posts use a **snowflake ID string** (`public_id`, 19 digits, time-ordered, non-enumerable) as the external identifier; `slug` is degraded to an internal alias kept only for compatibility with old links.
- Detail and collection endpoints look up by `public_id` and fall back to `slug`, so old addresses still work.
- `title`, `subtitle` (an independent field, max 200 characters) and `excerpt` are semantically distinct and are never reused for each other.
- Collections associate many-to-one with posts; deleting a collection automatically unlinks its posts.
- Image upload, limited to 10MB, stored in `server/uploads/`, publicly readable via `/api/blog/uploads/:name`.
- Draft preview: generates a short-lived preview link bound to a post for logged-in users; drafts remain 404 for anonymous visitors.
- Two admin authentication modes: built-in account password (`builtin`) or trusting only the `X-Auth-User` injected by the upstream auth layer (`sso`).

> `web/` and `admin/` are legacy frontends; they are stopped and not deployed with this service. The part actually maintained in this repo is `server/`.

## Quick start

Requires Node 24 (`better-sqlite3` is a native module; recompiling is needed after a Node major upgrade).

```bash
cd server
npm install
npm run dev     # node --watch src/index.ts
npm start       # node src/index.ts
```

On first start it creates the database and tables and writes sample posts, and prints one line with the initial admin username and password. It prints **only once**; save it immediately.
To choose your own, set `BLOG_ADMIN_USER` and `BLOG_ADMIN_PASSWORD` before the first start.

## API overview (prefix `/api/blog`)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/posts` | none | published post list, `?page=&tag=`, 10 per page, no body |
| GET | `/posts/:key` | optional | detail; `key` by `public_id` first, falling back to `slug`; drafts need a login or `?preview=` |
| GET | `/collections` | none | collection list with published post counts |
| GET | `/collections/:key` | none | collection detail with its published posts |
| GET | `/uploads/:name` | none | image |
| GET | `/auth-mode` | none | current auth mode `{ authMode }` |
| POST | `/admin/login` | none | login, returns a JWT and sets a session cookie (404 under `sso`) |
| POST | `/admin/logout` | none | logout, idempotent (404 under `sso`) |
| GET | `/admin/me` | required | current identity `{ name, role }` (404 under `sso`) |
| GET/POST | `/admin/posts` | required | all posts (including drafts) / create |
| PUT/DELETE | `/admin/posts/:id` | required | update / delete |
| GET | `/admin/posts/:id/preview-link` | required | build the post page URL, with a short-lived preview token for drafts |
| GET/POST | `/admin/collections` | required | all collections / create |
| PUT/DELETE | `/admin/collections/:id` | required | update / delete |
| POST | `/admin/upload` | required | image upload, field name `image` |

The `:id` in admin endpoints is the database auto-increment integer id, not the snowflake ID; a post's external identifier is always `public_id`.

## Configuration

Copy `server/.env.example` to `server/.env` and edit as needed. The keys actually read by the code:

| Variable | Default | Description |
| --- | --- | --- |
| `AUTH_MODE` | `builtin` | Admin auth mode; unset or invalid values always fall back to `builtin` |
| `PORT` | `4000` | Listening port |
| `JWT_SECRET` | `dev-secret` | JWT signing key; must be set explicitly in production |
| `DB_PATH` | `server/data/blog.db` | SQLite file path |
| `ADMIN_REDIS_URL` | `redis://127.0.0.1:6379` | Redis used for session verification |
| `ADMIN_REDIS_PREFIX` | `admin:session:` | Session key prefix; supports comma-separated multiple prefixes |
| `PREVIEW_TTL` | `30m` | Draft preview token lifetime |
| `PUBLIC_SITE_URL` | empty | Blog frontend base URL (with protocol); preview-link uses it to build absolute addresses, and falls back to a relative path with a warn when unset |
| `SNOWFLAKE_WORKER_ID` | `0` | Snowflake machine id for multi-instance deployments |
| `BLOG_ADMIN_USER` | `admin` | Username used when creating the admin on first start |
| `BLOG_ADMIN_PASSWORD` | random 16 characters | Password used when creating the admin on first start; random and printed once if unset |

## Data and migration

- SQLite via `better-sqlite3`, with WAL and `foreign_keys` enabled; tables are `collections` / `users` / `posts` / `tags`.
- There is no standalone migration framework: on startup missing columns are detected with `PRAGMA table_info` and added idempotently via `ALTER TABLE` (`collection_id`, `subtitle`, `public_id`), after which historical rows are backfilled with `public_id` and a unique index is created.
- `server/data/` (including `-wal` / `-shm`) and `server/uploads/` are not committed; include them when backing up.

## Deployment

- systemd unit: `blog-server.service`.
- The service listens only on `127.0.0.1:4000` and is exposed by nginx; there is no build artifact, it runs `src/index.ts` directly.
- nginx layer: `/api/blog/*` public reads pass through; `/api/blog/admin/*` goes to the auth gateway.
- When deployed behind the auth gateway, set `AUTH_MODE=sso` explicitly, otherwise the gateway-injected `X-Auth-User` is ignored under `builtin` and admin endpoints are unusable.

## Authentication and security

- `builtin` (default): `bcrypt` username/password login; on success it returns a JWT and sets an HttpOnly session cookie `admin_session` (`Path=/; SameSite=Lax`, plus `Secure` under HTTPS). Authentication accepts `Authorization: Bearer` or that cookie, verifies the JWT first and then the Redis session; in this mode `X-Auth-User` is ignored and cannot escalate privileges from an external header.
- `sso`: built-in passwords are off; only the `X-Auth-User` injected by the auth gateway is trusted, and a missing header is a 401; `admin/login|logout|me` return 404.
- The service binds `127.0.0.1`, preventing public clients from forging `X-Auth-User` to bypass the gateway.
- Uploads are limited to 10MB (no MIME type check); when reading an image the filename is taken as its basename, preventing path escapes out of `uploads/`.

## License

MIT, see `LICENSE`.
