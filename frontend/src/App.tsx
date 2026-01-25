import { useState } from 'react'
import YouTubeProcessor from './components/YouTubeProcessor'

type Tab = 'youtube' | 'dictation'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('youtube')

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-4">
            Ear2Finger
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300">
            Improve your English listening and dictation skills
          </p>
        </header>

        {/* Tab Navigation */}
        <div className="max-w-4xl mx-auto mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-1 inline-flex">
            <button
              onClick={() => setActiveTab('youtube')}
              className={`px-6 py-2 rounded-md font-semibold transition-colors ${
                activeTab === 'youtube'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              YouTube Videos
            </button>
            <button
              onClick={() => setActiveTab('dictation')}
              className={`px-6 py-2 rounded-md font-semibold transition-colors ${
                activeTab === 'dictation'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              Dictation Exercises
            </button>
          </div>
        </div>

        <main className="max-w-6xl mx-auto">
          {activeTab === 'youtube' && <YouTubeProcessor />}
          {activeTab === 'dictation' && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8">
              <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mb-6">
                Dictation Exercises
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                Process YouTube videos to create dictation exercises. Use the YouTube Videos tab to get started.
              </p>
            </div>
          )}
        </main>

        <footer className="mt-12 text-center text-gray-600 dark:text-gray-400">
          <p>© 2026 Ear2Finger - Practice makes perfect</p>
        </footer>
      </div>
    </div>
  )
}

export default App
