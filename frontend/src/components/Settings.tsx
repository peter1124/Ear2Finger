import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getConfig, setConfig, listUsers, createUser, updateUser, deleteUser, fetchMe, type AdminUser } from '../api'

type SettingsSection = 'ai-api-key' | 'keyboard' | 'about' | 'version' | 'users'

export default function Settings() {
  const navigate = useNavigate()
  const { user, logout, setUser } = useAuth()
  const [activeSection, setActiveSection] = useState<SettingsSection>('ai-api-key')
  const [aiVendor, setAiVendor] = useState('Gemini')
  const [apiKey, setApiKey] = useState('')

  // User management (superuser only)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [userForm, setUserForm] = useState({ username: '', email: '', password: '', is_superuser: false })
  const [userFormSaving, setUserFormSaving] = useState(false)
  const [userFormError, setUserFormError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState(false)

  const isSuperuser = user?.is_superuser === true

  const fetchUsers = useCallback(() => {
    if (!isSuperuser) return
    setUsersLoading(true)
    setUsersError(null)
    listUsers()
      .then(setUsers)
      .catch((e) => setUsersError(e.response?.data?.detail ?? 'Failed to load users'))
      .finally(() => setUsersLoading(false))
  }, [isSuperuser])

  useEffect(() => {
    getConfig()
      .then((c) => {
        if (c.ai_vendor) setAiVendor(c.ai_vendor)
        if (c.api_key) setApiKey(c.api_key)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (activeSection === 'users' && isSuperuser) fetchUsers()
  }, [activeSection, isSuperuser, fetchUsers])

  const openAddUser = () => {
    setEditingUser(null)
    setUserForm({ username: '', email: '', password: '', is_superuser: false })
    setUserFormError(null)
    setUserModalOpen(true)
  }

  const openEditUser = (u: AdminUser) => {
    setEditingUser(u)
    setUserForm({ username: u.username, email: u.email ?? '', password: '', is_superuser: u.is_superuser })
    setUserFormError(null)
    setUserModalOpen(true)
  }

  const handleSaveUser = async () => {
    setUserFormError(null)
    setUserFormSaving(true)
    try {
      if (editingUser) {
        await updateUser(editingUser.id, {
          username: userForm.username.trim(),
          email: userForm.email.trim() || undefined,
          password: userForm.password || undefined,
          is_superuser: userForm.is_superuser,
        })
      } else {
        if (!userForm.password.trim()) {
          setUserFormError('Password is required')
          setUserFormSaving(false)
          return
        }
        await createUser({
          username: userForm.username.trim(),
          email: userForm.email.trim() || undefined,
          password: userForm.password,
          is_superuser: userForm.is_superuser,
        })
      }
      setUserModalOpen(false)
      fetchUsers()
      if (editingUser?.id === user?.id) {
        fetchMe().then(setUser).catch(() => {})
      }
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { detail?: string | string[] } } }
      const d = ax.response?.data?.detail
      setUserFormError(Array.isArray(d) ? d.map((x: unknown) => (typeof x === 'object' && x && 'msg' in x ? (x as { msg?: string }).msg : String(x))).join(', ') : (d as string) ?? 'Failed to save')
    } finally {
      setUserFormSaving(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!deleteTarget) return
    setDeleteConfirming(true)
    try {
      await deleteUser(deleteTarget.id)
      setDeleteTarget(null)
      fetchUsers()
      if (deleteTarget.id === user?.id) logout()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { detail?: string } } }
      setUsersError(ax.response?.data?.detail ?? 'Failed to delete user')
    } finally {
      setDeleteConfirming(false)
    }
  }

  const settingsSections = [
    { id: 'ai-api-key' as SettingsSection, label: 'AI API-KEY' },
    { id: 'keyboard' as SettingsSection, label: 'KEYBOARD' },
    ...(isSuperuser ? [{ id: 'users' as SettingsSection, label: 'USERS' }] : []),
    { id: 'about' as SettingsSection, label: 'ABOUT' },
    { id: 'version' as SettingsSection, label: 'VERSION' },
  ]

  const handleApply = async () => {
    try {
      await setConfig({ ai_vendor: aiVendor, api_key: apiKey || null })
      console.log('Settings saved')
    } catch (e) {
      console.error('Failed to save settings', e)
    }
  }

  const handleCancel = () => {
    // Reset or cancel changes
    navigate('/workspace')
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/icon.png" alt="Ear2Finger" className="w-8 h-8" />
          <span className="text-lg font-semibold text-gray-900">Ear2Finger</span>
        </div>

        <nav className="flex items-center gap-1">
          <button
            onClick={() => navigate('/workspace')}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Workspace
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Dashboard
          </button>
          <button className="px-4 py-2 bg-gray-900 text-white rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </nav>

        <div className="flex items-center gap-2 text-gray-700">
          <span className="font-medium">{user?.username ?? 'User'}</span>
          <button
            onClick={() => logout()}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col">
          {/* Settings Navigation */}
          <div className="flex-1 overflow-y-auto p-4 space-y-1">
            {settingsSections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  activeSection === section.id
                    ? 'bg-gray-900 text-white'
                    : 'bg-white hover:bg-gray-100 text-gray-900'
                }`}
              >
                <span className="font-medium">{section.label}</span>
              </button>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="p-4 border-t border-gray-200 space-y-3">
            <button
              onClick={handleCancel}
              className="w-full bg-white border-2 border-gray-900 text-gray-900 font-medium py-2.5 px-4 rounded-lg hover:bg-gray-50 transition-colors"
            >
              CANCEL
            </button>
            <button
              onClick={handleApply}
              className="w-full bg-gray-900 text-white font-medium py-2.5 px-4 rounded-lg hover:bg-gray-800 transition-colors"
            >
              APPLY
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-white p-6">
          {activeSection === 'ai-api-key' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">AI API-KEY</h1>

              <div className="space-y-6">
                {/* AI Vendor Dropdown */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    AI Vendor
                  </label>
                  <div className="relative">
                    <select
                      value={aiVendor}
                      onChange={(e) => setAiVendor(e.target.value)}
                      className="w-full bg-gray-900 text-white px-4 py-3 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-700"
                    >
                      <option value="Gemini">Gemini</option>
                      <option value="OpenAI">OpenAI</option>
                      <option value="Anthropic">Anthropic</option>
                      <option value="Other">Other</option>
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* API Key Text Area */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    API-KEY
                  </label>
                  <textarea
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your API key here..."
                    rows={8}
                    className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'keyboard' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">KEYBOARD</h1>
              <p className="text-gray-600">Keyboard settings coming soon...</p>
            </div>
          )}

          {activeSection === 'about' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">ABOUT</h1>
              <div className="space-y-4 text-gray-700">
                <p>
                  <strong>Ear2Finger</strong> is a language learning application designed to improve your English listening and dictation skills.
                </p>
                <p>
                  Practice with YouTube videos, get real-time feedback, and track your progress.
                </p>
              </div>
            </div>
          )}

          {activeSection === 'version' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">VERSION</h1>
              <div className="space-y-4 text-gray-700">
                <p>
                  <strong>Version:</strong> 1.0.0
                </p>
                <p>
                  <strong>Build Date:</strong> {new Date().toLocaleDateString()}
                </p>
              </div>
            </div>
          )}

          {activeSection === 'users' && isSuperuser && (
            <div className="max-w-4xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">Users</h1>
              {usersError && (
                <div className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{usersError}</div>
              )}
              <div className="mb-4">
                <button
                  type="button"
                  onClick={openAddUser}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                >
                  Add user
                </button>
              </div>
              {usersLoading ? (
                <p className="text-gray-600">Loading users…</p>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-sm font-semibold text-gray-900">Username</th>
                        <th className="px-4 py-3 text-sm font-semibold text-gray-900">Email</th>
                        <th className="px-4 py-3 text-sm font-semibold text-gray-900">Superuser</th>
                        <th className="px-4 py-3 text-sm font-semibold text-gray-900">Created</th>
                        <th className="px-4 py-3 text-sm font-semibold text-gray-900 w-32">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {users.map((u) => (
                        <tr key={u.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-900">{u.username}</td>
                          <td className="px-4 py-3 text-gray-600">{u.email ?? '—'}</td>
                          <td className="px-4 py-3">{u.is_superuser ? 'Yes' : 'No'}</td>
                          <td className="px-4 py-3 text-gray-600 text-sm">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => openEditUser(u)}
                              className="text-gray-700 hover:text-gray-900 mr-3"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(u)}
                              className="text-red-600 hover:text-red-800"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Add/Edit user modal */}
      {userModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">{editingUser ? 'Edit user' : 'Add user'}</h2>
            {userFormError && (
              <div className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{userFormError}</div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  type="text"
                  value={userForm.username}
                  onChange={(e) => setUserForm((f) => ({ ...f, username: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email (optional)</label>
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password {editingUser ? '(leave blank to keep)' : ''}
                </label>
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm((f) => ({ ...f, password: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  placeholder={editingUser ? '••••••••' : ''}
                />
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={userForm.is_superuser}
                  onChange={(e) => setUserForm((f) => ({ ...f, is_superuser: e.target.checked }))}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">Superuser</span>
              </label>
            </div>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveUser}
                disabled={userFormSaving || !userForm.username.trim()}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                {userFormSaving ? 'Saving…' : editingUser ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Delete user</h2>
            <p className="text-gray-600 mb-4">
              Delete user <strong>{deleteTarget.username}</strong>? This cannot be undone.
              {deleteTarget.id === user?.id && ' You will be signed out.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={deleteConfirming}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteConfirming ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
