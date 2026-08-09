// List.jsx —— 文章列表页：标题 / 日期 / 摘要 / 标签
// 支持分页（?page=）与按标签筛选（?tag=），筛选状态反映在 URL 中
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getPosts } from '../api'

// 把数据库里的 "YYYY-MM-DD HH:MM:SS" 格式化为中文日期
function formatDate(str) {
  if (!str) return ''
  const d = new Date(str.replace(' ', 'T'))
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function List() {
  // 从 URL 读取当前页与筛选标签
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1)
  const tag = searchParams.get('tag') || ''

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getPosts({ page, tag })
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, tag])

  // 切换页码，同时保留标签筛选
  function changePage(next) {
    const params = new URLSearchParams(searchParams)
    params.set('page', String(next))
    setSearchParams(params)
  }

  // 清除标签筛选
  function clearTag() {
    const params = new URLSearchParams(searchParams)
    params.delete('tag')
    params.delete('page')
    setSearchParams(params)
  }

  if (loading) return <p className="hint">加载中…</p>
  if (error) return <p className="hint error">{error}</p>

  if (!data || data.list.length === 0) {
    return (
      <div>
        <p className="hint">
          {tag ? `「${tag}」标签下暂时没有文章` : '这里还空无一物'}
        </p>
        {tag && (
          <button className="link-btn" onClick={clearTag}>
            清除标签筛选
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      {tag && (
        <p className="filter-tip">
          正在查看标签「{tag}」
          <button className="link-btn filter-clear" onClick={clearTag}>
            × 清除筛选
          </button>
        </p>
      )}

      <ul className="post-list">
        {data.list.map((post) => (
          <li key={post.id} className="post-item">
            <Link className="post-title" to={`/post/${post.slug}`}>
              {post.title}
            </Link>
            <p className="post-excerpt">{post.excerpt}</p>
            <div className="post-meta">
              <time className="post-date" dateTime={post.created_at}>
                {formatDate(post.created_at)}
              </time>
              {post.tags.length > 0 && (
                <span className="post-tags">
                  {post.tags.map((t) => (
                    <Link key={t} className="tag" to={`/?tag=${encodeURIComponent(t)}`}>
                      {t}
                    </Link>
                  ))}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {data.totalPages > 1 && (
        <nav className="pagination">
          <button
            className="link-btn"
            disabled={data.page <= 1}
            onClick={() => changePage(data.page - 1)}
          >
            ← 上一页
          </button>
          <span className="page-info">
            {data.page} / {data.totalPages}
          </span>
          <button
            className="link-btn"
            disabled={data.page >= data.totalPages}
            onClick={() => changePage(data.page + 1)}
          >
            下一页 →
          </button>
        </nav>
      )}
    </div>
  )
}
