// api.js —— 前台 fetch 封装（公开接口，无需鉴权）

const BASE = '/api'

// 通用请求：解析错误信息并抛出
async function request(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    let message = '请求失败'
    try {
      const body = await res.json()
      message = body.message || message
    } catch (_) {
      /* 响应不是 JSON 时忽略 */
    }
    throw new Error(message)
  }
  return res.json()
}

// 文章列表：支持分页与按标签筛选
export function getPosts({ page = 1, tag = '' } = {}) {
  const params = new URLSearchParams({ page: String(page) })
  if (tag) params.set('tag', tag)
  return request(`/posts?${params.toString()}`)
}

// 文章详情
export function getPost(slug) {
  return request(`/posts/${encodeURIComponent(slug)}`)
}
