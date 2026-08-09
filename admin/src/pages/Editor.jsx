// Editor.jsx —— 新建 / 编辑文章
// 表单字段：标题、slug、摘要、标签、Markdown 正文、发布状态（发布 / 存草稿）
import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { createPost, updatePost, getAdminPosts } from '../api'

export default function Editor() {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()

  const [form, setForm] = useState({
    title: '',
    slug: '',
    excerpt: '',
    content: '',
    published: true,
  })
  const [tagsText, setTagsText] = useState('')
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 编辑模式：加载原文并填充表单
  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    setLoading(true)
    setError('')
    getAdminPosts()
      .then((res) => {
        const post = (res.list || []).find((p) => p.id === Number(id))
        if (!post) throw new Error('文章不存在')
        if (cancelled) return
        setForm({
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          content: post.content,
          published: post.published,
        })
        setTagsText(post.tags.join(', '))
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
  }, [id, isEdit])

  // 更新单个字段
  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // 保存：published 由按钮决定（发布 / 存草稿）
  async function handleSave(published) {
    if (!form.title.trim()) {
      setError('标题不能为空')
      return
    }
    setSaving(true)
    setError('')

    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim(),
      excerpt: form.excerpt.trim(),
      content: form.content,
      // 兼容中文逗号、顿号与换行分隔
      tags: tagsText
        .split(/[,，、\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
      published,
    }

    try {
      if (isEdit) {
        await updatePost(id, payload)
      } else {
        await createPost(payload)
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="hint">加载中…</p>

  return (
    <div className="editor">
      <div className="editor-head">
        <Link className="back-link" to="/">
          ← 返回列表
        </Link>
        <h1 className="panel-title">{isEdit ? '编辑文章' : '新建文章'}</h1>
      </div>

      {error && <p className="form-error">{error}</p>}

      <form
        className="editor-form"
        onSubmit={(e) => {
          e.preventDefault()
          handleSave(form.published)
        }}
      >
        <label className="field">
          <span className="field-label">标题 *</span>
          <input
            className="input"
            type="text"
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="文章标题"
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Slug（访问链接，留空自动生成）</span>
            <input
              className="input"
              type="text"
              value={form.slug}
              onChange={(e) => setField('slug', e.target.value)}
              placeholder="my-first-post"
            />
          </label>

          <label className="field">
            <span className="field-label">标签（逗号分隔）</span>
            <input
              className="input"
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="前端, 笔记"
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">摘要</span>
          <textarea
            className="textarea"
            rows="2"
            value={form.excerpt}
            onChange={(e) => setField('excerpt', e.target.value)}
            placeholder="列表页显示的摘要"
          />
        </label>

        <label className="field">
          <span className="field-label">内容（Markdown）</span>
          <textarea
            className="textarea textarea-lg"
            rows="18"
            value={form.content}
            onChange={(e) => setField('content', e.target.value)}
            placeholder="支持 Markdown 语法：标题、列表、代码块、表格…"
          />
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.published}
            onChange={(e) => setField('published', e.target.checked)}
          />
          <span>发布状态（勾选为发布，取消勾选则为草稿）</span>
        </label>

        <div className="editor-actions">
          <button className="btn btn-ghost" type="button" onClick={() => navigate('/')}>
            取消
          </button>
          <button
            className="btn"
            type="button"
            disabled={saving}
            onClick={() => handleSave(false)}
          >
            {saving ? '保存中…' : '存为草稿'}
          </button>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? '保存中…' : isEdit ? '保存修改' : '发布'}
          </button>
        </div>
      </form>
    </div>
  )
}
