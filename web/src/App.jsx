// App.jsx —— 前台路由与整体布局
// 路由：文章列表（/）与文章详情（/post/:slug）
import { Routes, Route, Link } from 'react-router-dom'
import List from './pages/List'
import Post from './pages/Post'

export default function App() {
  return (
    <div className="site">
      <header className="site-header">
        <Link className="site-title" to="/">
          我的博客
        </Link>
        <nav className="site-nav">
          <Link to="/">文章</Link>
        </nav>
      </header>

      <main className="site-main">
        <Routes>
          <Route path="/" element={<List />} />
          <Route path="/post/:slug" element={<Post />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="site-footer">
        <span>© {new Date().getFullYear()} 我的博客</span>
        <span className="footer-sep">·</span>
        <span>用简单的方式记录</span>
        <span className="footer-sep">·</span>
        <a href="http://localhost:5174" target="_blank" rel="noreferrer">
          管理
        </a>
      </footer>
    </div>
  )
}

// 404 兜底页
function NotFound() {
  return (
    <div>
      <p className="hint">页面不存在</p>
      <Link className="link-btn" to="/">
        ← 返回首页
      </Link>
    </div>
  )
}
