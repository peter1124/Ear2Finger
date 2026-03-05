import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  getConfig,
  setConfig,
  listAIKeys,
  addAIKey,
  activateAIKey,
  deleteAIKey,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  fetchMe,
  type AdminUser,
  type AIProvider,
  type SetConfigPayload,
  type AIKeyHint,
} from '../api'

type SettingsSection = 'ai-api-key' | 'about' | 'users'

export default function Settings() {
  const navigate = useNavigate()
  const { user, logout, setUser } = useAuth()
  const [activeSection, setActiveSection] = useState<SettingsSection>('ai-api-key')
  const [aiProvider, setAiProvider] = useState<AIProvider>('gemini')
  const [apiKey, setApiKey] = useState('')
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false)
  const [hasGeminiKey, setHasGeminiKey] = useState(false)
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false)
  const [aiConfigError, setAiConfigError] = useState<string | null>(null)
  const [aiKeys, setAiKeys] = useState<AIKeyHint[]>([])
  const [aiKeysLoading, setAiKeysLoading] = useState(false)
  const [aiKeysError, setAiKeysError] = useState<string | null>(null)

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

  const loadAIKeys = useCallback(() => {
    setAiKeysLoading(true)
    setAiKeysError(null)
    Promise.allSettled([
      listAIKeys('openai'),
      listAIKeys('gemini'),
      listAIKeys('anthropic'),
    ])
      .then((results) => {
        const fulfilled = results.filter(
          (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof listAIKeys>>> =>
            r.status === 'fulfilled'
        )
        const allKeys = fulfilled.flatMap((r) => r.value.keys)
        setAiKeys(allKeys)
        if (fulfilled.length === 0) {
          setAiKeysError('Failed to load API keys')
        }
      })
      .catch(() => {
        setAiKeysError('Failed to load API keys')
      })
      .finally(() => setAiKeysLoading(false))
  }, [])

  useEffect(() => {
    getConfig()
      .then((c) => {
        if (c.ai_provider) setAiProvider(c.ai_provider)
        setHasOpenaiKey(Boolean(c.has_openai_api_key))
        setHasGeminiKey(Boolean(c.has_gemini_api_key))
        setHasAnthropicKey(Boolean(c.has_anthropic_api_key))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (activeSection === 'users' && isSuperuser) fetchUsers()
  }, [activeSection, isSuperuser, fetchUsers])

  useEffect(() => {
    if (activeSection === 'ai-api-key') {
      loadAIKeys()
    }
  }, [activeSection, loadAIKeys])

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
    ...(isSuperuser ? [{ id: 'users' as SettingsSection, label: 'USERS' }] : []),
    { id: 'about' as SettingsSection, label: 'ABOUT' },
  ]

  const handleApply = async () => {
    setAiConfigError(null)
    try {
      const trimmedKey = apiKey.trim()
      if (trimmedKey) {
        // Add a new key for the selected provider and make it active
        await addAIKey(aiProvider, trimmedKey, true)
        await setConfig({ ai_provider: aiProvider } satisfies SetConfigPayload)
      } else {
        // Only update provider selection
        await setConfig({ ai_provider: aiProvider } satisfies SetConfigPayload)
      }
      setApiKey('')

      // Refresh key status after saving
      const c = await getConfig()
      if (c.ai_provider) setAiProvider(c.ai_provider)
      setHasOpenaiKey(Boolean(c.has_openai_api_key))
      setHasGeminiKey(Boolean(c.has_gemini_api_key))
      setHasAnthropicKey(Boolean(c.has_anthropic_api_key))
      loadAIKeys()
      console.log('Settings saved')
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { detail?: string } } }
      setAiConfigError(ax.response?.data?.detail ?? 'Failed to save AI settings')
      console.error('Failed to save settings', e)
    }
  }

  const handleActivateKey = async (provider: AIProvider, keyId: string) => {
    setAiConfigError(null)
    try {
      await activateAIKey(provider, keyId)
      await setConfig({ ai_provider: provider } satisfies SetConfigPayload)
      const c = await getConfig()
      if (c.ai_provider) setAiProvider(c.ai_provider)
      setHasOpenaiKey(Boolean(c.has_openai_api_key))
      setHasGeminiKey(Boolean(c.has_gemini_api_key))
      setHasAnthropicKey(Boolean(c.has_anthropic_api_key))
      loadAIKeys()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { detail?: string } } }
      setAiConfigError(ax.response?.data?.detail ?? 'Failed to activate API key')
    }
  }

  const handleDeleteKey = async (provider: AIProvider, keyId: string) => {
    setAiConfigError(null)
    try {
      await deleteAIKey(provider, keyId)
      const c = await getConfig()
      if (c.ai_provider) setAiProvider(c.ai_provider)
      setHasOpenaiKey(Boolean(c.has_openai_api_key))
      setHasGeminiKey(Boolean(c.has_gemini_api_key))
      setHasAnthropicKey(Boolean(c.has_anthropic_api_key))
      loadAIKeys()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { detail?: string } } }
      setAiConfigError(ax.response?.data?.detail ?? 'Failed to delete API key')
    }
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
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 511.999 511.999">
              <path d="M480.276,62.526H156.574c-17.493,0-31.725,14.231-31.725,31.725v28.232l-30.679-30.68l-51.975,51.975l23.592,23.592
                L0,270.705l66.804,104.419H41.579c-19.579,0-35.507,15.928-35.507,35.507v38.84h177.005v-38.84
                c0-19.579-15.928-35.507-35.507-35.507h-44.674l-66.83-104.459l44.077-69.235c-1.482,21.531,5.967,43.567,22.39,59.99
                l12.616,12.617l9.7-9.7v67.609c0,17.493,14.231,31.724,31.725,31.724h90.733l-5.361,55.401h-25.091v30.402h22.149h158.839h22.149
                v-30.402h-25.091l-5.36-55.401h90.732c17.493,0,31.725-14.231,31.725-31.724V94.252C512,76.758,497.768,62.526,480.276,62.526z
                 M147.569,405.526c2.815,0,5.105,2.29,5.105,5.105v8.439H36.474v-8.439c0-2.815,2.29-5.105,5.105-5.105H147.569z M105.999,148.902
                c-0.277,0.245-0.556,0.485-0.83,0.735c-0.878,0.8-1.743,1.616-2.587,2.46c-0.016,0.016-0.032,0.03-0.049,0.046
                s-0.03,0.032-0.046,0.049c-0.842,0.844-1.658,1.708-2.457,2.585c-0.253,0.278-0.498,0.561-0.746,0.842
                c-0.353,0.398-0.714,0.79-1.058,1.196l-13.035-13.035l8.979-8.98l13.035,13.035C106.796,148.181,106.4,148.545,105.999,148.902z
                 M116.365,229.831c-7.548-13.358-8.017-29.656-1.423-43.384c0.046-0.095,0.092-0.19,0.138-0.284
                c0.231-0.473,0.471-0.943,0.719-1.411c0.066-0.125,0.135-0.248,0.203-0.372c0.239-0.441,0.484-0.88,0.74-1.313
                c0.085-0.145,0.173-0.288,0.26-0.433c0.247-0.412,0.499-0.823,0.76-1.228c0.106-0.164,0.217-0.326,0.325-0.489
                c0.252-0.382,0.507-0.763,0.772-1.138c0.135-0.19,0.277-0.378,0.414-0.566c0.25-0.344,0.5-0.687,0.76-1.026
                c0.178-0.231,0.365-0.456,0.548-0.684c0.233-0.291,0.462-0.584,0.703-0.87c0.254-0.303,0.52-0.597,0.783-0.894
                c0.183-0.207,0.361-0.418,0.548-0.622c0.46-0.502,0.931-0.994,1.415-1.478c0.539-0.539,1.09-1.06,1.65-1.568
                c0.161-0.147,0.327-0.286,0.49-0.431c0.408-0.361,0.82-0.719,1.238-1.062c0.18-0.149,0.365-0.292,0.547-0.438
                c0.418-0.333,0.838-0.662,1.265-0.979c0.173-0.13,0.349-0.256,0.525-0.383c0.455-0.329,0.915-0.65,1.379-0.961
                c0.149-0.1,0.298-0.2,0.449-0.298c0.52-0.339,1.046-0.667,1.576-0.984c0.099-0.06,0.198-0.121,0.297-0.179
                c3.916-2.297,8.095-3.977,12.398-5.042c0.069-0.017,0.138-0.036,0.207-0.054c0.676-0.164,1.356-0.311,2.038-0.445
                c0.057-0.011,0.113-0.024,0.171-0.036c0.696-0.134,1.394-0.25,2.095-0.353c0.041-0.006,0.082-0.013,0.123-0.019
                c0.708-0.101,1.42-0.186,2.131-0.255c0.035-0.003,0.07-0.007,0.105-0.011c0.709-0.067,1.419-0.118,2.13-0.152
                c0.044-0.002,0.086-0.005,0.13-0.007c0.692-0.032,1.385-0.048,2.078-0.05c0.064,0,0.128-0.001,0.193-0.001
                c1.958,0.003,3.915,0.127,5.86,0.372c0.043,0.005,0.085,0.013,0.128,0.018c0.845,0.109,1.687,0.248,2.526,0.403
                c0.246,0.046,0.492,0.095,0.738,0.145c0.649,0.131,1.294,0.279,1.938,0.437c0.285,0.071,0.572,0.136,0.855,0.212
                c0.764,0.204,1.524,0.428,2.28,0.67c0.395,0.128,0.786,0.269,1.179,0.407c0.497,0.174,0.992,0.351,1.484,0.542
                c0.428,0.167,0.852,0.345,1.276,0.524c0.394,0.167,0.785,0.341,1.176,0.518c0.435,0.199,0.87,0.397,1.298,0.61
                c0.41,0.203,0.815,0.421,1.22,0.636c0.341,0.181,0.685,0.354,1.021,0.543l-31.927,31.927L116.365,229.831z M272.491,419.07
                l5.361-55.401h81.147l5.36,55.401H272.491z M481.598,331.945c0,0.729-0.594,1.323-1.323,1.323h-93.674H250.249h-93.675
                c-0.73,0-1.323-0.593-1.323-1.323v-28.309h326.348V331.945z M481.598,273.234H155.251v-39.3l69.176-69.176l-12.617-12.616
                c-7.677-7.677-16.585-13.387-26.091-17.152c-0.082-0.032-0.165-0.061-0.248-0.093c-1.079-0.424-2.166-0.826-3.26-1.199
                c-0.32-0.109-0.646-0.206-0.967-0.311c-0.85-0.278-1.701-0.55-2.56-0.798c-0.547-0.158-1.099-0.298-1.649-0.444
                c-0.63-0.166-1.26-0.337-1.893-0.487c-0.749-0.179-1.502-0.335-2.256-0.493c-0.434-0.089-0.865-0.184-1.3-0.266
                c-0.918-0.174-1.841-0.324-2.767-0.466c-0.269-0.041-0.535-0.085-0.804-0.123c-1.053-0.15-2.11-0.274-3.17-0.379
                c-0.14-0.014-0.279-0.029-0.418-0.043c-1.154-0.109-2.312-0.191-3.472-0.248c-0.045-0.002-0.089-0.005-0.134-0.007
                c-1.854-0.088-3.711-0.135-5.574-0.089V94.252c0-0.73,0.594-1.323,1.323-1.323h323.702c0.73,0,1.323,0.594,1.323,1.323V273.234z"/>
            </svg>
            Workspace
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 32 32">
              <polygon points="4 20 4 22 8.586 22 2 28.586 3.414 30 10 23.414 10 28 12 28 12 20 4 20"/>
              <rect x="24.0001" y="21" width="2" height="5"/>
              <rect x="20.0001" y="16" width="2" height="10"/>
              <rect x="16" y="18" width="2" height="8"/>
              <path d="M28,2H4A2.002,2.002,0,0,0,2,4V16H4V13H28.001l.001,15H16v2H28a2.0027,2.0027,0,0,0,2-2V4A2.0023,2.0023,0,0,0,28,2ZM12,11H4V4h8Zm2,0V4H28l.0007,7Z"/>
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

        <div className="flex items-center gap-3 text-gray-700">
          <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-gray-50 border border-gray-200">
            <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5.121 17.804A9 9 0 1118.88 17.804M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <span className="font-medium text-sm">{user?.username ?? 'User'}</span>
          </div>
          <button
            onClick={() => logout()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-full border border-gray-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6A2.25 2.25 0 005.25 5.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3-3m0 0l3 3m-3-3v12"
              />
            </svg>
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
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-white p-6 flex justify-center">
          {activeSection === 'ai-api-key' && (
            <div className="w-full max-w-3xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">AI API-KEY</h1>
              <p className="text-sm text-gray-600 mb-6">
                Current provider: <strong className="text-gray-900">{aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'gemini' ? 'Gemini' : 'Anthropic'}</strong>
                {(aiProvider === 'openai' && hasOpenaiKey) ||
                 (aiProvider === 'gemini' && hasGeminiKey) ||
                 (aiProvider === 'anthropic' && hasAnthropicKey)
                  ? ' • API key configured'
                  : ' • No API key saved for this provider'}
              </p>

              <div className="space-y-6">
                {aiConfigError && (
                  <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{aiConfigError}</div>
                )}
                {/* AI Vendor Dropdown */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    AI Provider
                  </label>
                  <div className="relative">
                    <select
                      value={aiProvider}
                      onChange={(e) => setAiProvider(e.target.value as AIProvider)}
                      className="w-full bg-gray-900 text-white px-4 py-3 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-700"
                    >
                      <option value="gemini">Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
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
                    placeholder={
                      (aiProvider === 'openai' && hasOpenaiKey) ||
                      (aiProvider === 'gemini' && hasGeminiKey) ||
                      (aiProvider === 'anthropic' && hasAnthropicKey)
                        ? 'Key is configured. Paste a new key to replace it.'
                        : 'Enter your API key here...'
                    }
                    rows={8}
                    className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={handleApply}
                      className="px-4 py-2 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 transition-colors"
                    >
                      ADD
                    </button>
                  </div>
                </div>

                {/* Saved keys list (all providers) */}
                <div className="pt-4 border-t border-gray-200">
                  <h2 className="text-sm font-semibold text-gray-900 mb-2">
                    Saved keys
                  </h2>
                  {aiKeysError && (
                    <div className="mb-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{aiKeysError}</div>
                  )}
                  {aiKeysLoading ? (
                    <p className="text-sm text-gray-600">Loading keys…</p>
                  ) : aiKeys.length === 0 ? (
                    <p className="text-sm text-gray-600">No keys saved yet for this provider.</p>
                  ) : (
                    <ul className="space-y-2">
                      {aiKeys.map((k) => (
                        <li
                          key={k.id}
                          className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                        >
                          <div className="flex flex-col">
                            <span className="text-sm text-gray-900">
                              <span className="mr-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">
                                {k.provider === 'openai'
                                  ? 'OpenAI'
                                  : k.provider === 'gemini'
                                  ? 'Gemini'
                                  : 'Anthropic'}
                              </span>
                              …{k.last4 || '????'}
                              {k.is_active && (
                                <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                                  Active
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-gray-500">
                              Added {new Date(k.created_at).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {!k.is_active && (
                              <button
                                type="button"
                                onClick={() => handleActivateKey(k.provider, k.id)}
                                className="px-2 py-1 text-xs font-medium text-gray-900 border border-gray-300 rounded hover:bg-gray-50"
                              >
                                Activate
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteKey(k.provider, k.id)}
                              className="px-2 py-1 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

              </div>
            </div>
          )}

          {activeSection === 'about' && (
            <div className="w-full max-w-3xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">ABOUT</h1>
              <div className="space-y-4 text-gray-700">
                <p>
                  <strong>Ear2Finger</strong> is a language learning application designed to improve your English listening and dictation skills.
                </p>
                <p>
                  Practice with YouTube videos, get real-time feedback, and track your progress.
                </p>
                <div className="pt-4 mt-2 border-t border-gray-200 space-y-1">
                  <p>
                    <strong>Version:</strong> 1.0.0
                  </p>
                  <p>
                    <strong>Build Date:</strong> {new Date().toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'users' && isSuperuser && (
            <div className="w-full max-w-3xl">
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
