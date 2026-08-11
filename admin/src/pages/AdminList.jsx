// AdminList.jsx —— 文章管理列表
// 编辑式列表展示全部文章（标题 / 标签 / 状态 / 更新时间），提供新建、编辑、删除
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getAdminPosts, deletePost, logout } from '../api'

// 把 "YYYY-MM-DD HH:MM:SS" 格式化为中文日期时间
function formatDate(str) {
  if (!str) return ''
  const d = new Date(str.replace(' ', 'T'))
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminList() {
  const navigate = useNavigate()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 加载全部文章
  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await getAdminPosts()
      setList(res.list || [])
    } catch (err) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // 删除前二次确认
  async function handleDelete(post) {
    if (!window.confirm(`确定删除文章「${post.title}」吗？此操作不可恢复。`)) return
    try {
      await deletePost(post.id)
      await load()
    } catch (err) {
      window.alert(err.message || '删除失败')
    }
  }

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="minimalist-panel">
      <div className="panel-head">
        <div className="panel-head-text">
          <h1 className="panel-title">文章管理</h1>
          <p className="panel-tip">共 {list.length} 篇，含草稿</p>
        </div>
        <div className="panel-actions">
          <button className="btn btn-ghost" onClick={handleLogout}>
            退出登录
          </button>
          <Link className="btn btn-primary" to="/new">
            新建文章
          </Link>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      {loading ? (
        <p className="hint">加载中…</p>
      ) : list.length === 0 ? (
        <p className="hint">还没有文章，点击右上角「新建文章」开始写作。</p>
      ) : (
        <ul className="post-list">
          {list.map((post) => (
            <li key={post.id} className="post-item">
              <div className="post-item-main">
                <Link className="post-item-title" to={`/edit/${post.id}`}>
                  {post.title}
                </Link>
                <div className="post-item-meta">
                  <span
                    className={
                      post.published ? 'badge badge-on' : 'badge badge-off'
                    }
                  >
                    {post.published ? '已发布' : '草稿'}
                  </span>
                  <span className="post-item-date">{formatDate(post.updated_at)}</span>
                  {post.tags.length > 0 && (
                    <span className="post-item-tags">{post.tags.join('、')}</span>
                  )}
                </div>
              </div>
              <div className="post-item-actions">
                <Link className="btn btn-sm" to={`/edit/${post.id}`}>
                  编辑
                </Link>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDelete(post)}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
