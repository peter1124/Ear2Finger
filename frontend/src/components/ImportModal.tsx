import { useState, useEffect } from 'react'
import { api } from '../api'

interface Playlist {
  id: number
  name: string
  created_at: string
  video_count: number
}

interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImport: (payload: { url: string; playlistId: number }) => void
  defaultPlaylistId?: number | null
}

export default function ImportModal({ isOpen, onClose, onImport, defaultPlaylistId }: ImportModalProps) {
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      fetchPlaylists()
      setYoutubeUrl('')
      setSelectedPlaylistId(defaultPlaylistId || null)
      setNewPlaylistName('')
      setError(null)
    }
  }, [isOpen, defaultPlaylistId])

  const fetchPlaylists = async () => {
    try {
      const response = await api.get('/api/playlists')
      setPlaylists(response.data)
      if (response.data.length > 0 && !selectedPlaylistId) {
        setSelectedPlaylistId(defaultPlaylistId || response.data[0].id)
      }
    } catch (err) {
      console.error('Error fetching playlists:', err)
    }
  }

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) {
      setError('Please enter a playlist name')
      return
    }

    setIsCreatingPlaylist(true)
    setError(null)

    try {
      const response = await api.post('/api/playlists', {
        name: newPlaylistName.trim()
      })
      await fetchPlaylists()
      setSelectedPlaylistId(response.data.id)
      setNewPlaylistName('')
      setIsCreatingPlaylist(false)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? null
      setError(message || 'Failed to create playlist')
      setIsCreatingPlaylist(false)
    }
  }

  const handleImport = async () => {
    if (!youtubeUrl.trim()) {
      setError('Please enter a YouTube URL')
      return
    }

    if (!selectedPlaylistId) {
      setError('Please select or create a playlist')
      return
    }

    setError(null)
    onImport({ url: youtubeUrl.trim(), playlistId: selectedPlaylistId })
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Import YouTube Audio & Subtitles</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <>
            {/* YouTube URL Input */}
            <div className="mb-6">
              <label htmlFor="youtube-url" className="block text-sm font-medium text-gray-700 mb-2">
                YouTube URL
              </label>
              <input
                id="youtube-url"
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Playlist Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Playlist
              </label>

              {/* Existing Playlists */}
              <div className="space-y-2 mb-4">
                {playlists.map((playlist) => (
                  <label
                    key={playlist.id}
                    className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedPlaylistId === playlist.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="playlist"
                      value={playlist.id}
                      checked={selectedPlaylistId === playlist.id}
                      onChange={() => setSelectedPlaylistId(playlist.id)}
                      className="mr-3"
                    />
                    <div className="flex flex-row items-center w-full justify-between px-8">
                      <div className="text-sm text-gray-900">{playlist.name}</div>
                      <div className="text-xs text-gray-500">{playlist.video_count} videos</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Create New Playlist */}
              <div className="border-t border-gray-200 pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Or Create New Playlist
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    placeholder="Enter playlist name..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleCreatePlaylist()
                      }
                    }}
                  />
                  <button
                    onClick={handleCreatePlaylist}
                    disabled={isCreatingPlaylist || !newPlaylistName.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                  >
                    {isCreatingPlaylist ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!youtubeUrl.trim() || !selectedPlaylistId}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                Import
              </button>
            </div>
          </>
        </div>
      </div>
    </div>
  )
}
