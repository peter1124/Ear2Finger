import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const progressBarRef = useRef<HTMLDivElement>(null)
  const intervalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatCountRef = useRef(0)
  const skipNextSyncRef = useRef(false)
  const soughtTimeRef = useRef<number>(0)
  const soughtSegmentIndexRef = useRef<number | null>(null)
  const sentenceIndexFromPlaybackRef = useRef(false)
  const [isDraggingProgress, setIsDraggingProgress] = useState(false)

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
  const [repeatCount, setRepeatCount] = useState<number | '∞'>(3)
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

  // Handle time updates: keep currentTime and subtitle in sync with audio playback
  const totalDurationForSync = selectedLesson?.duration ?? 0
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !sentences.length) return

    const updateTime = () => {
      if (skipNextSyncRef.current) {
        setCurrentTime(soughtTimeRef.current)
        return
      }
      const t = audio.currentTime
      setCurrentTime(t)
      // Sync displayed subtitle to playhead: find sentence containing current time
      const nextIdx = sentences.findIndex((s, i) => {
        const nextStart = i + 1 < sentences.length ? sentences[i + 1].start_time : totalDurationForSync
        return t >= s.start_time && t < nextStart
      })
      const idx = nextIdx >= 0 ? nextIdx : (t < sentences[0].start_time ? 0 : sentences.length - 1)
      setCurrentSentenceIndex((prev) => {
        if (prev === idx) return prev
        sentenceIndexFromPlaybackRef.current = true
        return idx
      })
    }

    audio.addEventListener('timeupdate', updateTime)
    return () => audio.removeEventListener('timeupdate', updateTime)
  }, [sentences, totalDurationForSync])

  // Handle sentence-by-sentence playback
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !sentences.length || playbackMode !== 'sentence' || !isPlaying) return

    const currentSentence = sentences[currentSentenceIndex]
    if (!currentSentence) return

    const totalDuration = selectedLesson?.duration ?? 0

    const checkSentenceEnd = () => {
      if (!isPlaying) return
      const nextSentence = sentences[currentSentenceIndex + 1]
      // Use start_time only: advance when we reach the next sentence's start (or end of audio for last sentence)
      const hasReachedNext =
        nextSentence
          ? audio.currentTime >= nextSentence.start_time
          : totalDuration > 0 && audio.currentTime >= totalDuration

      if (hasReachedNext) {
        audio.pause()

        // Check if we need to repeat
        const shouldRepeat = repeatCount === '∞' || (typeof repeatCount === 'number' && repeatCountRef.current < repeatCount - 1)

        if (shouldRepeat) {
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
  }, [currentSentenceIndex, sentences, isPlaying, interval, repeatCount, playbackMode, selectedLesson?.duration])

  // Handle play/pause
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !sentences.length) return
    if (isDraggingProgress) return

    if (isPlaying) {
      // If user just sought via progress bar, use the ref so we don't depend on state timing
      const segmentIndex = soughtSegmentIndexRef.current
      if (segmentIndex !== null && sentences[segmentIndex]) {
        soughtSegmentIndexRef.current = null
        const t = sentences[segmentIndex].start_time
        audio.currentTime = t
        setCurrentTime(t)
        audio.play()
        return
      }
      const currentSentence = sentences[currentSentenceIndex]
      if (currentSentence) {
        if (audio.currentTime < currentSentence.start_time) {
          audio.currentTime = currentSentence.start_time
        }
        audio.play()
      }
    } else {
      audio.pause()
    }
  }, [isPlaying, currentSentenceIndex, sentences, isDraggingProgress])

  // Keep audio progress in sync with current subtitle: seek to current sentence's start_time when subtitle changes (e.g. prev/next). Skip when change came from playback (timeupdate) or user sought via progress bar.
  useEffect(() => {
    if (!audioRef.current || !sentences.length || isDraggingProgress) return
    const sentence = sentences[currentSentenceIndex]
    if (!sentence) return
    if (sentenceIndexFromPlaybackRef.current) {
      sentenceIndexFromPlaybackRef.current = false
      return
    }
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false
      setCurrentTime(soughtTimeRef.current)
      return
    }
    audioRef.current.currentTime = sentence.start_time
    setCurrentTime(sentence.start_time)
  }, [currentSentenceIndex, sentences, isDraggingProgress])

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
  const sentenceCount = sentences.length

  // Map click/drag position to nearest sentence and seek to its start
  const seekToNearestSentence = (clientX: number) => {
    const bar = progressBarRef.current
    if (!bar || !audioRef.current || !sentenceCount) return
    const rect = bar.getBoundingClientRect()
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const segmentIndex = Math.min(Math.floor(percent * sentenceCount), sentenceCount - 1)
    const sentence = sentences[segmentIndex]
    if (!sentence) return
    const newTime = sentence.start_time
    skipNextSyncRef.current = true
    soughtTimeRef.current = newTime
    soughtSegmentIndexRef.current = segmentIndex
    audioRef.current.currentTime = newTime
    setCurrentTime(newTime)
    setCurrentSentenceIndex(segmentIndex)
    console.log('sentence time', newTime)
    console.log('segmentIndex', segmentIndex)
    console.log('sentence', sentence)
    repeatCountRef.current = 0
    setIsPlaying(true)
  }

  useEffect(() => {
    if (!isDraggingProgress) return
    const onMouseMove = (e: MouseEvent) => seekToNearestSentence(e.clientX)
    const onMouseUp = () => setIsDraggingProgress(false)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    // seekToNearestSentence is stable per render; we only want to attach when drag starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingProgress])

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/icon.png" alt="Ear2Finger" className="w-8 h-8" />
          <span className="text-lg font-semibold text-gray-900">Ear2Finger</span>
        </div>

        <nav className="flex items-center gap-1">
          <button className="px-4 py-2 bg-gray-900 text-white rounded-lg flex items-center gap-2">
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

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
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
                <div className="flex items-start justify-between mb-1">
                  <h3 className={`font-small ${selectedLesson?.id === lesson.id ? 'text-white' : 'text-gray-900'}`}>
                    {lesson.title}
                  </h3>
                  {lesson.is_favorite && (
                    <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  )}
                </div>
                <div className={`text-xs ${selectedLesson?.id === lesson.id ? 'text-gray-300' : 'text-gray-600'}`}>
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
                {selectedLesson && <span className="text-gray-500 ml-2 text-base"></span>}
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
                    ref={progressBarRef}
                    className="flex-1 h-2 rounded-full overflow-hidden cursor-pointer select-none flex"
                    onClick={(e) => seekToNearestSentence(e.clientX)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setIsDraggingProgress(true)
                      seekToNearestSentence(e.clientX)
                    }}
                  >
                    {sentenceCount > 0 ? (
                      sentences.map((s, i) => {
                        const start = s.start_time
                        const end = i + 1 < sentences.length ? sentences[i + 1].start_time : totalDuration
                        const segmentDuration = end - start
                        const fillPercent =
                          currentTime <= start
                            ? 0
                            : segmentDuration <= 0 || currentTime >= end
                              ? 100
                              : (100 * (currentTime - start)) / segmentDuration
                        return (
                          <div
                            key={i}
                            className="relative flex-1 min-w-0 h-full"
                            style={{ width: `${100 / sentenceCount}%` }}
                          >
                            <div className="absolute inset-0 bg-gray-200" />
                            <div
                              className="absolute inset-0 bg-indigo-600 transition-all origin-left"
                              style={{ width: `${fillPercent}%` }}
                            />
                            {i > 0 && (
                              <div className="absolute left-0 top-0 w-px h-full bg-gray-300 z-10" />
                            )}
                          </div>
                        )
                      })
                    ) : (
                      <div className="flex-1 h-full bg-gray-200 rounded-full overflow-hidden relative">
                        <div
                          className="absolute inset-y-0 left-0 bg-indigo-600 transition-all rounded-full"
                          style={{ width: `${totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <span className="text-sm text-gray-600 min-w-[3rem]">
                    {formatTime(currentTime)} / {formatTime(totalDuration)}
                    {sentenceCount > 0 && (
                      <span className="ml-2 text-gray-500 bg-gray-100 rounded-full px-2 py-1">
                        {currentSentenceIndex + 1} / {sentenceCount}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              <div className="relative group">
                <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs cursor-pointer">
                  <span>Speed: {playbackSpeed}x</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[120px]">
                  {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => setPlaybackSpeed(speed)}
                      className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                        playbackSpeed === speed ? 'bg-gray-100 font-semibold' : ''
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative group">
                <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs cursor-pointer">
                  <span>Repeat: {repeatCount === '∞' ? '∞' : repeatCount}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[100px]">
                  {([0, 1, 3, 5, 10, '∞'] as const).map((count) => (
                    <button
                      key={String(count)}
                      onClick={() => setRepeatCount(count === '∞' ? '∞' : count)}
                      className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                        repeatCount === count ? 'bg-gray-100 font-semibold' : ''
                      }`}
                    >
                      {count === '∞' ? '∞' : count}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative group">
                <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs cursor-pointer">
                  <span>Interval: {interval} sec</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[120px]">
                  {[0, 3, 5, 10].map((sec) => (
                    <button
                      key={sec}
                      onClick={() => setInterval(sec)}
                      className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                        interval === sec ? 'bg-gray-100 font-semibold' : ''
                      }`}
                    >
                      {sec} sec
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative group">
                <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs cursor-pointer">
                  <span>Ignore punct.: {ignorePunctuation ? 'Yes' : 'No'}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[100px]">
                  <button
                    onClick={() => setIgnorePunctuation(true)}
                    className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                      ignorePunctuation ? 'bg-gray-100 font-semibold' : ''
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setIgnorePunctuation(false)}
                    className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                      !ignorePunctuation ? 'bg-gray-100 font-semibold' : ''
                    }`}
                  >
                    No
                  </button>
                </div>
              </div>
              <div className="relative group">
                <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs cursor-pointer">
                  <span>Ignore case: {ignoreCase ? 'Yes' : 'No'}</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[100px]">
                  <button
                    onClick={() => setIgnoreCase(true)}
                    className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                      ignoreCase ? 'bg-gray-100 font-semibold' : ''
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setIgnoreCase(false)}
                    className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                      !ignoreCase ? 'bg-gray-100 font-semibold' : ''
                    }`}
                  >
                    No
                  </button>
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
