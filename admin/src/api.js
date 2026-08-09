// api.js —— 管理后台请求封装
// 自动携带 localStorage 中的 JWT；收到 401 时清除 token 并跳转登录页

const BASE = '/api'
const TOKEN_KEY = 'blog_admin_token'

// ---------- token 读写 ----------

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function logout() {
  setToken('')
}

// ---------- 通用请求 ----------

async function request(path, options = {}) {
  const { redirectOn401 = true, ...fetchOptions } = options
  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  }

  // 已有 token 则附带 Authorization 头
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    ...fetchOptions,
    headers,
    body: fetchOptions.body ? JSON.stringify(fetchOptions.body) : undefined,
  })

  let data = null
  try {
    data = await res.json()
  } catch (_) {
    /* 空响应时忽略 */
  }

  // 401 且不是登录接口：清除 token 并跳转登录页
  if (res.status === 401 && redirectOn401) {
    setToken('')
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    throw new Error('登录已过期，请重新登录')
  }

  if (!res.ok) {
    throw new Error(data?.message || `请求失败（${res.status}）`)
  }
  return data
}

// ---------- 接口 ----------

// 登录：失败时保留服务端返回的错误信息（不触发跳转）
export function login(username, password) {
  return request('/admin/login', {
    method: 'POST',
    body: { username, password },
    redirectOn401: false,
  })
}

// 获取全部文章（含草稿）
export function getAdminPosts() {
  return request('/admin/posts')
}

// 新建文章
export function createPost(payload) {
  return request('/admin/posts', { method: 'POST', body: payload })
}

// 更新文章
export function updatePost(id, payload) {
  return request(`/admin/posts/${id}`, { method: 'PUT', body: payload })
}

// 删除文章
export function deletePost(id) {
  return request(`/admin/posts/${id}`, { method: 'DELETE' })
}
