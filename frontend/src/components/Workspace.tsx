import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import ImportModal from './ImportModal'

interface Playlist {
  id: number
  name: string
  created_at: string
  video_count: number
}

interface Lesson {
  id: number
  video_id: number
  title: string
  duration: number
  sentence_count: number
  is_favorite?: boolean
  audio_file_path?: string
}

interface Sentence {
  id: number
  sentence_text: string
  start_time: number
  end_time: number
  sentence_index: number
}

export default function Workspace() {
  const navigate = useNavigate()
  const audioRef = useRef<HTMLAudioElement>(null)
  const intervalTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const repeatCountRef = useRef(0)
  
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null)
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [sentences, setSentences] = useState<Sentence[]>([])
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [interval, setInterval] = useState(3)
  const [ignorePunctuation, setIgnorePunctuation] = useState(true)
  const [ignoreCase, setIgnoreCase] = useState(true)
  const [repeatCount, setRepeatCount] = useState(3)
  const [userInput, setUserInput] = useState('')
  const [scores, setScores] = useState({ correct: 22, partial: 1, incorrect: 1 })
  const [playbackMode, setPlaybackMode] = useState<'continuous' | 'sentence'>('sentence')
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)

  // Load playlists and lessons on component mount
  useEffect(() => {
    fetchPlaylists()
  }, [])

  useEffect(() => {
    if (selectedPlaylistId) {
      fetchLessons()
    }
  }, [selectedPlaylistId])

  const fetchPlaylists = async () => {
    try {
      const response = await axios.get('http://localhost:8000/api/playlists')
      setPlaylists(response.data)
      if (response.data.length > 0 && !selectedPlaylistId) {
        setSelectedPlaylistId(response.data[0].id)
      } else if (response.data.length === 0) {
        // Create default playlist if none exists
        const defaultPlaylist = await axios.post('http://localhost:8000/api/playlists', {
          name: 'Default Playlist'
        })
        setPlaylists([defaultPlaylist.data])
        setSelectedPlaylistId(defaultPlaylist.data.id)
      }
    } catch (err) {
      console.error('Error fetching playlists:', err)
    }
  }

  const fetchLessons = async () => {
    if (!selectedPlaylistId) return
    
    try {
      const response = await axios.get(`http://localhost:8000/api/playlists/${selectedPlaylistId}/videos`)
      const videos = response.data.map((item: any) => ({
        id: item.id,
        video_id: item.video_id,
        title: item.title || 'Untitled Video',
        duration: item.duration || 0,
        sentence_count: item.sentence_count || 0,
        audio_file_path: item.audio_file_path,
        is_favorite: false
      }))
      setLessons(videos)
      if (videos.length > 0 && !selectedLesson) {
        setSelectedLesson(videos[0])
        fetchSentences(videos[0].video_id)
      } else if (videos.length === 0) {
        setSelectedLesson(null)
      }
    } catch (err) {
      console.error('Error fetching lessons:', err)
    }
  }

  const fetchSentences = async (videoId: number) => {
    try {
      const response = await axios.get(`http://localhost:8000/api/youtube/videos/${videoId}/sentences`)
      setSentences(response.data)
      setCurrentSentenceIndex(0)
    } catch (err) {
      console.error('Error fetching sentences:', err)
    }
  }

  const handleLessonSelect = (lesson: Lesson) => {
    setSelectedLesson(lesson)
    fetchSentences(lesson.video_id)
    setUserInput('')
    setCurrentTime(0)
    setCurrentSentenceIndex(0)
    setIsPlaying(false)
    repeatCountRef.current = 0
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    if (intervalTimeoutRef.current) {
      clearTimeout(intervalTimeoutRef.current)
      intervalTimeoutRef.current = null
    }
  }

  // Update audio playback speed when speed changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed
    }
  }, [playbackSpeed])

  // Handle time updates
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const updateTime = () => {
      setCurrentTime(audio.currentTime)
    }

    audio.addEventListener('timeupdate', updateTime)
    return () => audio.removeEventListener('timeupdate', updateTime)
  }, [])

  // Handle sentence-by-sentence playback
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !sentences.length || playbackMode !== 'sentence' || !isPlaying) return

    const currentSentence = sentences[currentSentenceIndex]
    if (!currentSentence) return

    const checkSentenceEnd = () => {
      if (!isPlaying) return
      
      if (audio.currentTime >= currentSentence.end_time) {
        audio.pause()
        
        // Check if we need to repeat
        if (repeatCountRef.current < repeatCount - 1) {
          repeatCountRef.current++
          // Repeat current sentence
          audio.currentTime = currentSentence.start_time
          setTimeout(() => {
            if (isPlaying) {
              audio.play()
            }
          }, 100)
        } else {
          // Move to next sentence after interval
          repeatCountRef.current = 0
          if (intervalTimeoutRef.current) {
            clearTimeout(intervalTimeoutRef.current)
          }
          
          intervalTimeoutRef.current = setTimeout(() => {
            if (currentSentenceIndex < sentences.length - 1) {
              const nextIndex = currentSentenceIndex + 1
              setCurrentSentenceIndex(nextIndex)
              const nextSentence = sentences[nextIndex]
              if (nextSentence && audio) {
                audio.currentTime = nextSentence.start_time
                if (isPlaying) {
                  audio.play()
                }
              }
            } else {
              // Reached end of all sentences
              setIsPlaying(false)
              setCurrentSentenceIndex(0)
              if (audio) {
                audio.pause()
                audio.currentTime = 0
              }
            }
          }, interval * 1000)
        }
      }
    }

    const intervalId = setInterval(checkSentenceEnd, 50) // Check more frequently for better accuracy
    return () => {
      clearInterval(intervalId)
      if (intervalTimeoutRef.current) {
        clearTimeout(intervalTimeoutRef.current)
      }
    }
  }, [currentSentenceIndex, sentences, isPlaying, interval, repeatCount, playbackMode])

  // Handle play/pause
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !sentences.length) return

    if (isPlaying) {
      const currentSentence = sentences[currentSentenceIndex]
      if (currentSentence) {
        // Ensure we're at the start of the current sentence
        if (audio.currentTime < currentSentence.start_time || audio.currentTime > currentSentence.end_time) {
          audio.currentTime = currentSentence.start_time
        }
        audio.play()
      }
    } else {
      audio.pause()
    }
  }, [isPlaying, currentSentenceIndex, sentences])

  // Reset when sentences change
  useEffect(() => {
    if (sentences.length > 0) {
      setCurrentSentenceIndex(0)
      repeatCountRef.current = 0
      if (audioRef.current) {
        audioRef.current.currentTime = sentences[0].start_time
      }
    }
  }, [sentences])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const currentSentence = sentences[currentSentenceIndex] || null
  const totalDuration = selectedLesson?.duration || 0

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
          <button className="px-4 py-2 bg-gray-900 text-white rounded-lg flex items-center gap-2">
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
          <button 
            onClick={() => navigate('/settings')}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-2"
          >
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
          <div className="p-4 border-b border-gray-200">
            <div className="relative">
              <select
                value={selectedPlaylistId || ''}
                onChange={(e) => setSelectedPlaylistId(Number(e.target.value))}
                className="w-full appearance-none bg-white rounded-lg border border-gray-200 px-3 py-2 pr-8 cursor-pointer hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                {playlists.map((playlist) => (
                  <option key={playlist.id} value={playlist.id}>
                    {playlist.name}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {lessons.map((lesson) => (
              <div
                key={lesson.id}
                onClick={() => handleLessonSelect(lesson)}
                className={`p-4 rounded-lg cursor-pointer transition-colors ${
                  selectedLesson?.id === lesson.id
                    ? 'bg-gray-900 text-white'
                    : 'bg-white hover:bg-gray-100'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className={`font-medium ${selectedLesson?.id === lesson.id ? 'text-white' : 'text-gray-900'}`}>
                    {lesson.title}
                  </h3>
                  {lesson.is_favorite && (
                    <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  )}
                </div>
                <div className={`text-sm ${selectedLesson?.id === lesson.id ? 'text-gray-300' : 'text-gray-600'}`}>
                  Duration: {formatDuration(lesson.duration)} Sentences: {lesson.sentence_count}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 border-t border-gray-200">
            <button 
              onClick={() => setIsImportModalOpen(true)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Import By URL
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Top Panel */}
          <div className="p-4 border-b border-gray-200 bg-white">
            <div className="mb-4">
              <h1 className="text-xl font-semibold text-gray-900">
                {selectedLesson?.title || 'Select a lesson'} 
                {selectedLesson && <span className="text-gray-500 ml-2 text-base">✨ Simplified</span>}
              </h1>
            </div>

            {/* Audio Element (hidden) */}
            {selectedLesson && (
              <audio
                ref={audioRef}
                src={selectedLesson.audio_file_path ? `http://localhost:8000/api/youtube/videos/${selectedLesson.video_id}/audio` : undefined}
                onEnded={() => {
                  if (playbackMode === 'continuous') {
                    setIsPlaying(false)
                  }
                }}
                onError={(e) => {
                  console.error('Audio playback error:', e)
                  setIsPlaying(false)
                }}
              />
            )}

            <div className="flex items-center gap-4 mb-4">
              {/* Media Player */}
              <div className="flex-1 flex items-center gap-4">
                <button 
                  onClick={() => {
                    if (currentSentenceIndex > 0) {
                      setCurrentSentenceIndex(currentSentenceIndex - 1)
                      repeatCountRef.current = 0
                      if (audioRef.current && sentences[currentSentenceIndex - 1]) {
                        audioRef.current.currentTime = sentences[currentSentenceIndex - 1].start_time
                      }
                    }
                  }}
                  disabled={currentSentenceIndex === 0}
                  className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M8.445 14.832A1 1 0 0010 14v-2.798l5.445 3.63A1 1 0 0017 14V6a1 1 0 00-1.555-.832L10 8.798V6a1 1 0 00-1.555-.832l-6 4a1 1 0 000 1.664l6 4z" />
                  </svg>
                </button>
                <button 
                  onClick={() => {
                    if (!selectedLesson || !sentences.length) return
                    setIsPlaying(!isPlaying)
                  }}
                  disabled={!selectedLesson || !sentences.length}
                  className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPlaying ? (
                    <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                  )}
                </button>
                <button 
                  onClick={() => {
                    if (currentSentenceIndex < sentences.length - 1) {
                      setCurrentSentenceIndex(currentSentenceIndex + 1)
                      repeatCountRef.current = 0
                      if (audioRef.current && sentences[currentSentenceIndex + 1]) {
                        audioRef.current.currentTime = sentences[currentSentenceIndex + 1].start_time
                      }
                    }
                  }}
                  disabled={currentSentenceIndex >= sentences.length - 1}
                  className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M4.555 5.168A1 1 0 003 6v8a1 1 0 001.555.832L10 11.202V14a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4A1 1 0 0011 6v2.798l-5.445-3.63z" />
                  </svg>
                </button>
                <div className="flex-1 flex items-center gap-2">
                  <div 
                    className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden cursor-pointer"
                    onClick={(e) => {
                      if (!audioRef.current || !totalDuration) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      const percent = (e.clientX - rect.left) / rect.width
                      const newTime = percent * totalDuration
                      audioRef.current.currentTime = newTime
                      setCurrentTime(newTime)
                      
                      // Find the sentence that corresponds to this time
                      const sentenceIndex = sentences.findIndex(
                        s => newTime >= s.start_time && newTime <= s.end_time
                      )
                      if (sentenceIndex !== -1) {
                        setCurrentSentenceIndex(sentenceIndex)
                        repeatCountRef.current = 0
                      }
                    }}
                  >
                    <div 
                      className="h-full bg-indigo-600 transition-all"
                      style={{ width: `${totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm text-gray-600 min-w-[3rem]">
                    {formatTime(currentTime)} / {formatTime(totalDuration)}
                  </span>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              <div className="relative group">
                <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 text-sm cursor-pointer">
                  <span>Speed: {playbackSpeed}X</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[120px]">
                  {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => setPlaybackSpeed(speed)}
                      className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${
                        playbackSpeed === speed ? 'bg-gray-100 font-semibold' : ''
                      }`}
                    >
                      {speed}X
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative group">
                <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 text-sm cursor-pointer">
                  <span>Interval: {interval}sec</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[120px]">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((sec) => (
                    <button
                      key={sec}
                      onClick={() => setInterval(sec)}
                      className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${
                        interval === sec ? 'bg-gray-100 font-semibold' : ''
                      }`}
                    >
                      {sec}sec
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative group">
                <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 text-sm cursor-pointer">
                  <span>Ignore punct.: {ignorePunctuation ? 'Yes' : 'No'}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[100px]">
                  <button
                    onClick={() => setIgnorePunctuation(true)}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${
                      ignorePunctuation ? 'bg-gray-100 font-semibold' : ''
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setIgnorePunctuation(false)}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${
                      !ignorePunctuation ? 'bg-gray-100 font-semibold' : ''
                    }`}
                  >
                    No
                  </button>
                </div>
              </div>
              <div className="relative group">
                <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 text-sm cursor-pointer">
                  <span>Ignore case: {ignoreCase ? 'Yes' : 'No'}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[100px]">
                  <button
                    onClick={() => setIgnoreCase(true)}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${
                      ignoreCase ? 'bg-gray-100 font-semibold' : ''
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setIgnoreCase(false)}
                    className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${
                      !ignoreCase ? 'bg-gray-100 font-semibold' : ''
                    }`}
                  >
                    No
                  </button>
                </div>
              </div>
              <div className="relative group">
                <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 text-sm cursor-pointer">
                  <span>Repeat: {repeatCount}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[100px]">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => (
                    <button
                      key={count}
                      onClick={() => setRepeatCount(count)}
                      className={`w-full text-left px-4 py-2 hover:bg-gray-100 ${
                        repeatCount === count ? 'bg-gray-100 font-semibold' : ''
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-700">{scores.correct}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                  <span className="text-sm text-gray-700">{scores.partial}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                  <span className="text-sm text-gray-700">{scores.incorrect}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Middle Panel - Text Display */}
          <div className="flex-1 p-4 overflow-y-auto bg-white">
            {currentSentence ? (
              <div className="max-w-4xl mx-auto">
                <div className="text-lg leading-relaxed text-gray-900">
                  {currentSentence.sentence_text.split(' ').map((word, idx) => {
                    // Simple matching logic - in real app, this would compare with user input
                    // For now, showing a mix of correct, partial, and incorrect for demonstration
                    const wordStatus = idx % 10
                    let underlineClass = 'border-b-2 border-gray-300'
                    
                    if (wordStatus < 7) {
                      underlineClass = 'border-b-2 border-green-500' // Correct
                    } else if (wordStatus < 9) {
                      underlineClass = 'border-b-2 border-orange-500' // Partial
                    } else {
                      underlineClass = 'border-b-2 border-red-500' // Incorrect
                    }
                    
                    return (
                      <span key={idx} className={underlineClass}>
                        {word}{' '}
                      </span>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 py-12">
                Select a lesson to start practicing
              </div>
            )}
          </div>

          {/* Bottom Panel */}
          <div className="p-4 border-t border-gray-200 bg-white grid grid-cols-2 gap-4">
            <div>
              <input
                type="text"
                placeholder="Talk to AI"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="h-32 flex items-end gap-2">
                {[20, 35, 25, 45, 30, 40, 28, 32, 38, 42].map((height, idx) => (
                  <div
                    key={idx}
                    className="flex-1 bg-gray-400 rounded-t"
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Import Modal */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={() => {
          fetchPlaylists()
          if (selectedPlaylistId) {
            fetchLessons()
          }
        }}
        defaultPlaylistId={selectedPlaylistId}
      />
    </div>
  )
}
