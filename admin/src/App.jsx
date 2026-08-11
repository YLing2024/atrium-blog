// App.jsx —— 管理后台路由与整体布局
// 路由：登录（/login）、文章管理列表（/）、编辑页（/new 与 /edit/:id）
// 登录页独立居中展示；登录后的页面共用顶部栏骨架
import { Routes, Route, Navigate, Link, Outlet } from 'react-router-dom'
import Login from './pages/Login'
import AdminList from './pages/AdminList'
import Editor from './pages/Editor'
import { getToken } from './api'

// 需要登录才能访问的路由：未登录时重定向到登录页
function RequireAuth({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />
}

// 登录后页面的公共骨架：顶部栏 + 内容区
function Shell() {
  return (
    <div className="shell">
      <header className="admin-header">
        <div className="header-inner">
          <Link className="admin-title" to="/">
            博客管理后台
          </Link>
          <span className="admin-sub">Posts · 简单内容管理</span>
        </div>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <div className="admin minimalist">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Shell />}>
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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
