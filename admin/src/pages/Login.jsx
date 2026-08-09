// Login.jsx —— 管理员登录页
// 登录成功后把 JWT 存入 localStorage 并跳转到文章管理列表
import { useState } from 'react'
import { useNavigate, Navigate, Link } from 'react-router-dom'
import { login, setToken, getToken } from '../api'

export default function Login() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 已登录则直接进入管理列表
  if (getToken()) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username || !password) {
      setError('请输入账号和密码')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await login(username, password)
      setToken(res.token)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-box">
      <h1 className="login-title">登录</h1>
      <p className="login-tip">默认账号：admin / admin123</p>

      {error && <p className="form-error">{error}</p>}

      <form onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">账号</span>
          <input
            className="input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入管理员账号"
            autoComplete="username"
          />
        </label>

        <label className="field">
          <span className="field-label">密码</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            autoComplete="current-password"
          />
        </label>

        <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
          {loading ? '登录中…' : '登录'}
        </button>
      </form>

      <Link className="login-back" to="/">
        ← 返回博客前台
      </Link>
    </div>
  )
}
