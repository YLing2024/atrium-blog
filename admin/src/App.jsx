// App.jsx —— 管理后台路由与整体布局
// 路由：登录（/login）、文章管理列表（/）、编辑页（/new 与 /edit/:id）
import { Routes, Route, Navigate, Link } from 'react-router-dom'
import Login from './pages/Login'
import AdminList from './pages/AdminList'
import Editor from './pages/Editor'
import { getToken } from './api'

// 需要登录才能访问的路由：未登录时重定向到登录页
function RequireAuth({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <div className="admin">
      <header className="admin-header">
        <Link className="admin-title" to="/">
          博客管理后台
        </Link>
        <span className="admin-sub">简单内容管理</span>
      </header>

      <main className="admin-main">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AdminList />
              </RequireAuth>
            }
          />
          <Route
            path="/new"
            element={
              <RequireAuth>
                <Editor />
              </RequireAuth>
            }
          />
          <Route
            path="/edit/:id"
            element={
              <RequireAuth>
                <Editor />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
