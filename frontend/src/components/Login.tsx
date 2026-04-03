import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username.trim(), password)
      navigate('/workspace', { replace: true })
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string | string[] } }; code?: string }
      let msg = 'Login failed'
      if (ax.response?.data?.detail !== undefined) {
        const d = ax.response.data.detail
        msg = Array.isArray(d) ? d.join(', ') : String(d)
      } else if (ax.code === 'ECONNABORTED') {
        msg = 'Request timed out. Is the server running?'
      } else if (!ax.response) {
        msg = 'Network error. Is the server running?'
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 py-6">
      <div className="w-full max-w-sm p-5 sm:p-6 bg-white rounded-xl shadow-md border border-gray-200">
        <div className="flex justify-center items-center gap-4 mb-6">
          <img src="/icon.png" alt="" className="w-20 h-20 shrink-0" aria-hidden />
          <span className="text-3xl font-semibold text-gray-900 tracking-tight">Ear2Finger</span>
        </div>
        <h1 className="text-xl font-bold text-center text-gray-900 mb-6">Sign in</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-800 focus:border-transparent"
              required
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-800 focus:border-transparent"
              required
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-600">
          Don't have an account?{' '}
          <Link to="/register" className="font-medium text-gray-900 hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
