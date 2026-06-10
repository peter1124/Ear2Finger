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
  onImport: (payload: {
    type: 'youtube' | 'local'
    url?: string
    filePath?: string
    subtitlePath?: string
    playlistId: number
  }) => void
  defaultPlaylistId?: number | null
}

export default function ImportModal({ isOpen, onClose, onImport, defaultPlaylistId }: ImportModalProps) {
  const [activeTab, setActiveTab] = useState<'youtube' | 'local'>('youtube')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [mediaPath, setMediaPath] = useState('')
  const [subtitlePath, setSubtitlePath] = useState('')
  
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      fetchPlaylists()
      setYoutubeUrl('')
      setMediaPath('')
      setSubtitlePath('')
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

  const handleImport = () => {
    if (!selectedPlaylistId) {
      setError('Please select or create a playlist')
      return
    }

    if (activeTab === 'youtube') {
      if (!youtubeUrl.trim()) {
        setError('Please enter a YouTube URL')
        return
      }
      setError(null)
      onImport({
        type: 'youtube',
        url: youtubeUrl.trim(),
        playlistId: selectedPlaylistId
      })
    } else {
      if (!mediaPath.trim()) {
        setError('Please enter a media file path')
        return
      }
      setError(null)
      onImport({
        type: 'local',
        filePath: mediaPath.trim(),
        subtitlePath: subtitlePath.trim() || undefined,
        playlistId: selectedPlaylistId
      })
    }
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">Import English Lesson</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200 mb-6">
            <button
              onClick={() => {
                setActiveTab('youtube')
                setError(null)
              }}
              className={`flex-1 py-2 text-center font-medium text-sm border-b-2 transition-colors ${
                activeTab === 'youtube'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              YouTube URL
            </button>
            <button
              onClick={() => {
                setActiveTab('local')
                setError(null)
              }}
              className={`flex-1 py-2 text-center font-medium text-sm border-b-2 transition-colors ${
                activeTab === 'local'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Local File
            </button>
          </div>

          <>
            {/* YouTube URL Input Tab */}
            {activeTab === 'youtube' && (
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
            )}

            {/* Local File Input Tab */}
            {activeTab === 'local' && (
              <div className="mb-6 space-y-4">
                <div>
                  <label htmlFor="media-path" className="block text-sm font-medium text-gray-700 mb-2">
                    Media File Path (Absolute)
                  </label>
                  <input
                    id="media-path"
                    type="text"
                    value={mediaPath}
                    onChange={(e) => setMediaPath(e.target.value)}
                    placeholder="e.g. C:\Videos\lesson1.mp4"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label htmlFor="subtitle-path" className="block text-sm font-medium text-gray-700 mb-2">
                    Subtitle File Path (Optional .srt/.vtt)
                  </label>
                  <input
                    id="subtitle-path"
                    type="text"
                    value={subtitlePath}
                    onChange={(e) => setSubtitlePath(e.target.value)}
                    placeholder="e.g. C:\Videos\lesson1.srt"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

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
                    <div className="flex flex-row items-center w-full justify-between pl-2 pr-1 sm:px-8">
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
                disabled={
                  selectedPlaylistId === null ||
                  (activeTab === 'youtube' && !youtubeUrl.trim()) ||
                  (activeTab === 'local' && !mediaPath.trim())
                }
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
