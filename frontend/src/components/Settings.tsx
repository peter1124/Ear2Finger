import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

type SettingsSection = 'ai-api-key' | 'keyboard' | 'about' | 'version'

export default function Settings() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<SettingsSection>('ai-api-key')
  const [aiVendor, setAiVendor] = useState('Gemini')
  const [apiKey, setApiKey] = useState('')

  const settingsSections = [
    { id: 'ai-api-key' as SettingsSection, label: 'AI API-KEY' },
    { id: 'keyboard' as SettingsSection, label: 'KEYBOARD' },
    { id: 'about' as SettingsSection, label: 'ABOUT' },
    { id: 'version' as SettingsSection, label: 'VERSION' },
  ]

  const handleApply = () => {
    // Save settings logic here
    console.log('Applying settings:', { aiVendor, apiKey })
    // You can add API call here to save settings
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
          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
            </svg>
          </div>
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
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="font-medium">Hang Yin</span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-80 bg-gray-50 border-r border-gray-200 flex flex-col">
          {/* Settings Title with Dropdown */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2 cursor-pointer hover:bg-gray-50">
              <div className="w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                  <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="flex-1 font-semibold text-gray-900">Settings</span>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

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
        </main>
      </div>
    </div>
  )
}
