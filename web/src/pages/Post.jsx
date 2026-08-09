// Post.jsx —— 文章详情页：用 marked 渲染 Markdown 正文，代码块使用统一样式
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { marked } from 'marked'
import { getPost } from '../api'

// 开启 GFM 表格与自动换行
marked.setOptions({ gfm: true, breaks: true })

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

export default function Post() {
  const { slug } = useParams()
  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getPost(slug)
      .then((res) => {
        if (!cancelled) setPost(res)
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
  }, [slug])

  if (loading) return <p className="hint">加载中…</p>

  if (error) {
    return (
      <div>
        <p className="hint error">{error}</p>
        <Link className="link-btn" to="/">
          ← 返回列表
        </Link>
      </div>
    )
  }

  // 把 Markdown 转成 HTML
  const html = marked.parse(post.content || '')

  return (
    <article>
      <Link className="back-link" to="/">
        ← 返回列表
      </Link>

      <header className="post-header">
        <h1 className="post-h1">{post.title}</h1>
        <div className="post-meta">
          <time dateTime={post.created_at}>{formatDate(post.created_at)}</time>
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
      </header>

      {/* 渲染 Markdown 正文 */}
      <div
        className="markdown"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  )
}
