import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, upsertCurrentLessonSession, saveLessonSession } from '../api'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspace, type Lesson } from '../contexts/WorkspaceContext'
import ImportModal from './ImportModal'
import LessonHistory from './LessonHistory'

interface Notification {
  id: string
  type: 'success' | 'error' | 'info'
  message: string
}

export default function Workspace() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const ws = useWorkspace()
  const {
    playlists,
    setPlaylists,
    selectedPlaylistId,
    setSelectedPlaylistId,
    selectedLesson,
    setSelectedLesson,
    lessons,
    setLessons,
    sentences,
    setSentences,
    sentencesVideoId,
    setSentencesVideoId,
    currentSentenceIndex,
    setCurrentSentenceIndex,
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    playbackSpeed,
    setPlaybackSpeed,
    pauseInterval,
    setPauseInterval,
    ignorePunctuation,
    setIgnorePunctuation,
    ignoreCase,
    setIgnoreCase,
    repeatCount,
    setRepeatCount,
    wordInputs,
    setWordInputs,
    wordHintIndex,
    setWordHintIndex,
    wordHintUsed,
    setWordHintUsed,
    wordErrorChars,
    setWordErrorChars,
    videoSessionScores,
    setVideoSessionScores,
    resetVideoSessionScores,
  } = ws

  const audioRef = useRef<HTMLAudioElement>(null)
  const intervalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isWaitingForPauseIntervalRef = useRef(false)
  const repeatCountRef = useRef(0)
  const sentenceIndexFromPlaybackRef = useRef(false)
  const userInitiatedSentenceChangeRef = useRef(false)
  const programmaticSeekRef = useRef(false)
  const wordInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const prevSentencesIdentityRef = useRef<string | null>(null)
  const prevSentenceKeyRef = useRef<number | null>(null)
  const prevVideoIdForScoresRef = useRef<number | null>(null)
  const sessionStartedAtRef = useRef<string>(new Date().toISOString())
  const sessionSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isImportInProgress, setIsImportInProgress] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null)

  // Load playlists and lessons on component mount
  useEffect(() => {
    fetchPlaylists()
  }, [])

  useEffect(() => {
    if (selectedPlaylistId) {
      fetchLessons()
    }
  }, [selectedPlaylistId])

  // When we have a selected lesson but sentences for another video (or none), fetch sentences.
  useEffect(() => {
    if (!selectedLesson) return
    if (sentencesVideoId === selectedLesson.video_id && sentences.length > 0) return
    fetchSentences(selectedLesson.video_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchSentences is stable enough; avoid refetch loop
  }, [selectedLesson?.id, selectedLesson?.video_id, sentencesVideoId, sentences.length])

  // Reset per-video session scores only when user switches to a different video, not on first load or remount.
  useEffect(() => {
    const videoId = selectedLesson?.video_id ?? null
    if (prevVideoIdForScoresRef.current === videoId) return
    const hadPreviousVideo = prevVideoIdForScoresRef.current !== null
    prevVideoIdForScoresRef.current = videoId
    if (selectedLesson) sessionStartedAtRef.current = new Date().toISOString()
    if (hadPreviousVideo && videoId !== null) resetVideoSessionScores()
  }, [selectedLesson?.video_id, resetVideoSessionScores])


  // Fetch audio as blob so the request includes auth header
  const audioBlobUrlRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedLesson?.audio_file_path || !selectedLesson?.video_id) {
      if (audioBlobUrlRef.current) {
        URL.revokeObjectURL(audioBlobUrlRef.current)
        audioBlobUrlRef.current = null
      }
      setAudioBlobUrl(null)
      return
    }
    let cancelled = false
    api.get(`/api/youtube/videos/${selectedLesson.video_id}/audio`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        if (audioBlobUrlRef.current) URL.revokeObjectURL(audioBlobUrlRef.current)
        const url = URL.createObjectURL(res.data as Blob)
        audioBlobUrlRef.current = url
        setAudioBlobUrl(url)
      })
      .catch(() => !cancelled && setAudioBlobUrl(null))
    return () => {
      cancelled = true
      if (audioBlobUrlRef.current) {
        URL.revokeObjectURL(audioBlobUrlRef.current)
        audioBlobUrlRef.current = null
      }
      setAudioBlobUrl(null)
    }
  }, [selectedLesson?.video_id, selectedLesson?.audio_file_path])

  const fetchPlaylists = async () => {
    try {
      const response = await api.get('/api/playlists')
      setPlaylists(response.data)
      if (response.data.length > 0 && !selectedPlaylistId) {
        setSelectedPlaylistId(response.data[0].id)
      } else if (response.data.length === 0) {
        // Create default playlist if none exists
        const defaultPlaylist = await api.post('/api/playlists', {
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
      const response = await api.get(`/api/playlists/${selectedPlaylistId}/videos`)
      const videos = response.data.map((item: { id: number; video_id: number; title?: string; duration?: number; sentence_count?: number; audio_file_path?: string }) => ({
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
      }
      // Do not set selectedLesson to null when videos.length === 0, so we keep progress if the API returns empty (e.g. transient error)
    } catch (err) {
      console.error('Error fetching lessons:', err)
    }
  }

  const pushNotification = (type: Notification['type'], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setNotifications((prev) => [...prev, { id, type, message }])
    setTimeout(() => {
      setNotifications((prev) => prev.filter((note) => note.id !== id))
    }, 5000)
  }

  const runImportInBackground = async (payload: { url: string; playlistId: number }) => {
    setIsImportInProgress(true)
    try {
      const processResponse = await api.post('/api/youtube/process', {
        url: payload.url
      })
      const videoId = processResponse.data.video_id
      await api.post(`/api/playlists/${payload.playlistId}/videos/${videoId}`)
      pushNotification('success', 'Import complete. Video added to playlist.')
      await fetchPlaylists()
      if (selectedPlaylistId === payload.playlistId) {
        await fetchLessons()
      }
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? null
      pushNotification('error', message || 'Import failed. Please try again.')
    } finally {
      setIsImportInProgress(false)
    }
  }

  const fetchSentences = async (videoId: number) => {
    try {
      const response = await api.get(`/api/youtube/videos/${videoId}/sentences`)
      setSentences(response.data)
      setSentencesVideoId(videoId)
      setCurrentSentenceIndex(0)
    } catch (err) {
      console.error('Error fetching sentences:', err)
    }
  }

  const handleLessonSelect = (lesson: Lesson) => {
    if (
      selectedLesson &&
      lesson.video_id !== selectedLesson.video_id &&
      (currentSentenceIndex >= 1 || isCurrentSentenceFullyCorrect)
    ) {
      saveLessonSession({
        video_id: selectedLesson.video_id,
        started_at: sessionStartedAtRef.current,
        ended_at: new Date().toISOString(),
        sentences_practiced: currentSentenceIndex + 1,
        correct_chars: videoSessionScores.correctChars,
        hint_count: videoSessionScores.hintCount,
        incorrect_chars: videoSessionScores.incorrectChars,
      }).catch(() => {})
    }
    sessionStartedAtRef.current = new Date().toISOString()
    setSelectedLesson(lesson)
    fetchSentences(lesson.video_id)
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

  // Handle time updates: keep progress bar (currentTime) in sync with audio playback
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !sentences.length) return

    const updateTime = () => {
      const t = audio.currentTime
      setCurrentTime(t)
    }

    audio.addEventListener('timeupdate', updateTime)
    return () => audio.removeEventListener('timeupdate', updateTime)
  }, [sentences])

  // Handle sentence-by-sentence playback
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !sentences.length || !isPlaying) return

    const currentSentence = sentences[currentSentenceIndex]
    if (!currentSentence) return

    const totalDuration = selectedLesson?.duration ?? 0

    const checkSentenceEnd = () => {
      if (!isPlaying) return

      const nextSentence = sentences[currentSentenceIndex + 1]
      const endTime = nextSentence
            ? nextSentence.start_time
            : totalDuration

      if (!endTime || endTime <= 0) return

      const hasReachedEnd = audio.currentTime >= endTime
      if (!hasReachedEnd) return

      // When repeat is ∞, only advance when the user has spelled the current sentence fully correctly
      const words = currentSentence.sentence_text.split(/\s+/).filter(Boolean)
      const norm = (w: string) => {
        let s = w
        if (ignoreCase) s = s.toLowerCase()
        if (ignorePunctuation) s = s.replace(/[^\w\s]/g, '')
        return s
      }
      const isCurrentSentenceFullyCorrect =
        words.length === wordInputs.length &&
        words.every((w, i) => norm(w) === norm(wordInputs[i] ?? ''))
      const shouldRepeat =
        repeatCount === '∞'
          ? !isCurrentSentenceFullyCorrect
          : (typeof repeatCount === 'number' && repeatCountRef.current <= repeatCount - 1)

      if (pauseInterval > 0) {
        // Simulate "click pause" at start: UI and audio show paused
        isWaitingForPauseIntervalRef.current = true
        if (intervalTimeoutRef.current) clearTimeout(intervalTimeoutRef.current)
        intervalTimeoutRef.current = setTimeout(() => {
          isWaitingForPauseIntervalRef.current = false
          intervalTimeoutRef.current = null
          const audioEl = audioRef.current
          if (!audioEl) return
          const playAfterSeek = (targetTime: number) => {
            setCurrentTime(targetTime)
            programmaticSeekRef.current = true
            setIsPlaying(true)
            let fallback: ReturnType<typeof setTimeout>
            const onSeeked = () => {
              audioEl.removeEventListener('seeked', onSeeked)
              clearTimeout(fallback)
              audioEl.play().catch(() => {})
            }
            audioEl.addEventListener('seeked', onSeeked, { once: true })
            audioEl.currentTime = targetTime
            fallback = setTimeout(() => {
              if (audioEl.paused) {
                audioEl.removeEventListener('seeked', onSeeked)
                audioEl.play().catch(() => {})
              }
            }, 200)
          }
          if (shouldRepeat) {
            repeatCountRef.current++
            if (currentSentence) {
              playAfterSeek(currentSentence.start_time)
            } else {
              setIsPlaying(true)
            }
          } else {
            repeatCountRef.current = 0
            if (currentSentenceIndex < sentences.length - 1) {
              const nextIndex = currentSentenceIndex + 1
              setCurrentSentenceIndex(nextIndex)
              const ns = sentences[nextIndex]
              if (ns) {
                playAfterSeek(ns.start_time)
                userInitiatedSentenceChangeRef.current = true
              } else {
                setIsPlaying(true)
              }
            } else {
              setCurrentSentenceIndex(0)
              audioEl.currentTime = 0
              setCurrentTime(0)
            }
          }
        }, pauseInterval * 1000)
        setIsPlaying(false) // simulate "click pause"
      } else {
        if (shouldRepeat) {
          repeatCountRef.current++
          const audioEl = audioRef.current
          if (audioEl && currentSentence) {
            audioEl.currentTime = currentSentence.start_time
            audioEl.play().catch(() => {})
          }
        } else {
          repeatCountRef.current = 0
          const audioEl = audioRef.current
          if (!audioEl) return
          if (currentSentenceIndex < sentences.length - 1) {
            const nextIndex = currentSentenceIndex + 1
            setCurrentSentenceIndex(nextIndex)
            const ns = sentences[nextIndex]
            if (ns) {
              audioEl.currentTime = ns.start_time
              audioEl.play().catch(() => {})
            }
          } else {
            setIsPlaying(false)
            setCurrentSentenceIndex(0)
            audioEl.pause()
            audioEl.currentTime = 0
          }
        }
      }
    }

    const intervalId = setInterval(checkSentenceEnd, 50) // Check more frequently for better accuracy
    return () => {
      clearInterval(intervalId)
      if (intervalTimeoutRef.current && !isWaitingForPauseIntervalRef.current) {
        clearTimeout(intervalTimeoutRef.current)
        intervalTimeoutRef.current = null
      }
    }
  }, [currentSentenceIndex, sentences, isPlaying, pauseInterval, repeatCount, selectedLesson?.duration, wordInputs, ignoreCase, ignorePunctuation])

  // Keep audio progress in sync with current subtitle: seek to current sentence's start_time when subtitle changes.
  useEffect(() => {
    if (!audioRef.current || !sentences.length) return
    const sentence = sentences[currentSentenceIndex]
    if (!sentence) return
    if (programmaticSeekRef.current) {
      programmaticSeekRef.current = false
      return
    }
    if (userInitiatedSentenceChangeRef.current) {
      userInitiatedSentenceChangeRef.current = false
      return
    }
    if (sentenceIndexFromPlaybackRef.current) {
      sentenceIndexFromPlaybackRef.current = false
      return
    }
    audioRef.current.currentTime = sentence.start_time
    setCurrentTime(sentence.start_time)
  }, [currentSentenceIndex, sentences])

  // Reset to sentence 0 only when sentences actually change (e.g. new lesson). Do not reset on remount or Strict Mode double-invocation.
  useEffect(() => {
    if (sentences.length === 0) return
    const identity = `${sentencesVideoId ?? ''}-${sentences.length}-${sentences[0]?.id ?? ''}`
    if (prevSentencesIdentityRef.current === identity) return
    const isNewSentences = prevSentencesIdentityRef.current !== null
    prevSentencesIdentityRef.current = identity
    if (isNewSentences && !isPlaying) {
      setCurrentSentenceIndex(0)
      repeatCountRef.current = 0
      if (audioRef.current) {
        audioRef.current.currentTime = sentences[0].start_time
      }
    }
  }, [sentences, sentencesVideoId, isPlaying])

  // Handle play/pause
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !sentences.length) return

    if (isPlaying) {
      if (intervalTimeoutRef.current) {
        clearTimeout(intervalTimeoutRef.current)
        intervalTimeoutRef.current = null
      }
      isWaitingForPauseIntervalRef.current = false
      if (programmaticSeekRef.current) {
        programmaticSeekRef.current = false
        audio.play()
        return
      }
      const currentSentence = sentences[currentSentenceIndex]
      if (currentSentence) {
        if (currentSentenceIndex > 0 && audio.currentTime < currentSentence.start_time) {
          audio.currentTime = currentSentence.start_time
        }
        audio.play()
      }
    } else {
      audio.pause()
    }
  }, [isPlaying, currentSentenceIndex, sentences])

  // Keyboard shortcuts: [ previous sentence, ] next sentence, Enter play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
      const isShortcutKey = e.key === '[' || e.key === ']' || e.key === 'Enter'
      if (inInput && !isShortcutKey) return

      if (e.key === '[') {
        e.preventDefault()
        if (currentSentenceIndex > 0 && sentences.length) {
          userInitiatedSentenceChangeRef.current = true
          const prevIndex = currentSentenceIndex - 1
          setCurrentSentenceIndex(prevIndex)
          repeatCountRef.current = 0
          if (audioRef.current && sentences[prevIndex]) {
            audioRef.current.currentTime = sentences[prevIndex].start_time
            setCurrentTime(sentences[prevIndex].start_time)
          }
        }
        return
      }
      if (e.key === ']') {
        e.preventDefault()
        if (currentSentenceIndex >= sentences.length - 1) return
        const nextIndex = currentSentenceIndex + 1
        const nextSentence = sentences[nextIndex]
        if (!nextSentence) return
        userInitiatedSentenceChangeRef.current = true
        if (intervalTimeoutRef.current) {
          clearTimeout(intervalTimeoutRef.current)
          intervalTimeoutRef.current = null
        }
        isWaitingForPauseIntervalRef.current = false
        repeatCountRef.current = 0
        setCurrentSentenceIndex(nextIndex)
        setCurrentTime(nextSentence.start_time)
        if (audioRef.current) {
          audioRef.current.currentTime = nextSentence.start_time
          audioRef.current.play().catch(() => {})
        }
        setIsPlaying(true)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (!selectedLesson || !sentences.length) return
        setIsPlaying((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentSentenceIndex, sentences, selectedLesson])

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

  // Check if current sentence is fully correct
  const isCurrentSentenceFullyCorrect = currentSentence && (() => {
    const words = currentSentence.sentence_text.split(/\s+/).filter(Boolean)
    const norm = (w: string) => {
      let s = w
      if (ignoreCase) s = s.toLowerCase()
      if (ignorePunctuation) s = s.replace(/[^\w\s]/g, '')
      return s
    }
    return words.length === wordInputs.length &&
      words.every((w, i) => norm(w) === norm(wordInputs[i] ?? ''))
  })()

  const hasCompletedOneSentence =
    sentences.length > 0 &&
    (currentSentenceIndex >= 1 || Boolean(isCurrentSentenceFullyCorrect))

  // Auto-save lesson session when at least one sentence has been completed.
  useEffect(() => {
    if (!selectedLesson || !hasCompletedOneSentence) return
    const payload = {
      video_id: selectedLesson.video_id,
      started_at: sessionStartedAtRef.current,
      ended_at: null as string | null,
      sentences_practiced: currentSentenceIndex + 1,
      correct_chars: videoSessionScores.correctChars,
      hint_count: videoSessionScores.hintCount,
      incorrect_chars: videoSessionScores.incorrectChars,
    }
    if (sessionSaveTimeoutRef.current) clearTimeout(sessionSaveTimeoutRef.current)
    sessionSaveTimeoutRef.current = setTimeout(() => {
      sessionSaveTimeoutRef.current = null
      upsertCurrentLessonSession(payload).catch(() => {})
    }, 800)
    return () => {
      if (sessionSaveTimeoutRef.current) clearTimeout(sessionSaveTimeoutRef.current)
    }
  }, [
    selectedLesson?.id,
    hasCompletedOneSentence,
    currentSentenceIndex,
    videoSessionScores.correctChars,
    videoSessionScores.hintCount,
    videoSessionScores.incorrectChars,
  ])

  // Reset per-word inputs and hint when current sentence changes. Skip on initial mount to preserve restored progress.
  useEffect(() => {
    if (!currentSentence) {
      prevSentenceKeyRef.current = null
      setWordInputs([])
      setWordHintIndex(null)
      setWordHintUsed([])
      setWordErrorChars([])
      return
    }
    const key = currentSentence.id
    if (prevSentenceKeyRef.current !== null && prevSentenceKeyRef.current !== key) {
      const words = currentSentence.sentence_text.split(/\s+/).filter(Boolean)
      setWordInputs(words.map(() => ''))
      setWordHintIndex(null)
      setWordHintUsed(words.map(() => false))
      setWordErrorChars(words.map(() => 0))
      wordInputRefs.current = []
    }
    prevSentenceKeyRef.current = key
  }, [currentSentenceIndex, currentSentence?.id])

  // When switching to a new sentence, focus the first word input after the new inputs are in the DOM.
  useEffect(() => {
    if (!currentSentence) return
    const t1 = setTimeout(() => {
      wordInputRefs.current[0]?.focus()
    }, 0)
    const t2 = setTimeout(() => {
      wordInputRefs.current[0]?.focus()
    }, 100)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [currentSentenceIndex, currentSentence?.id])

  const normalizeWord = (w: string) => {
    let s = w
    if (ignoreCase) s = s.toLowerCase()
    if (ignorePunctuation) s = s.replace(/[^\w\s]/g, '')
    return s
  }

  // Persist per-sentence learning progress whenever word inputs or hints change.
  // This keeps backend stats in sync even if the user doesn't fully complete a sentence.
  useEffect(() => {
    if (!currentSentence || !selectedLesson) return
    const words = currentSentence.sentence_text.split(/\s+/).filter(Boolean)
    if (!words.length) return

    const normalize = (w: string) => {
      let s = w
      if (ignoreCase) s = s.toLowerCase()
      if (ignorePunctuation) s = s.replace(/[^\w\s]/g, '')
      return s
    }

    const correctWords: string[] = []
    const incorrectWords: string[] = []
    const hintWords: string[] = []

    words.forEach((w, idx) => {
      const input = (wordInputs[idx] ?? '').trim()
      if (!input) return
      if (normalize(input) === normalize(w)) {
        correctWords.push(w)
      } else {
        incorrectWords.push(w)
      }
      if (wordHintUsed[idx]) {
        hintWords.push(w)
      }
    })

    const data = {
      attempts: 1,
      total_words: words.length,
      words,
      correct_words: correctWords,
      incorrect_words: incorrectWords,
      hint_words: hintWords,
      error_chars: wordErrorChars,
      completed: Boolean(isCurrentSentenceFullyCorrect),
    }

    api
      .post('/api/user/progress', {
        video_id: selectedLesson.video_id,
        sentence_id: currentSentence.id,
        data,
      })
      .catch(() => {
        // best-effort; failures will be retried on next change
      })
  }, [
    currentSentence,
    selectedLesson,
    wordInputs,
    wordHintUsed,
    ignoreCase,
    ignorePunctuation,
    isCurrentSentenceFullyCorrect,
  ])

  const getWordUnderlineClass = (targetWord: string, inputValue: string) => {
    if (inputValue.length === 0) return 'border-b-2 border-gray-300'
    const target = normalizeWord(targetWord)
    const input = normalizeWord(inputValue)
    for (let i = 0; i < input.length; i++) {
      if (i >= target.length || input[i] !== target[i]) return 'border-b-4 border-red-500'
    }
    if (input.length < target.length) return 'border-b-4 border-yellow-500'
    return 'border-b-4 border-green-500'
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
          {/* Async import progress bar (non-blocking) */}
          {isImportInProgress && (
            <div className="flex-shrink-0 px-4 py-2 bg-indigo-50 border-b border-indigo-100">
              <p className="text-sm text-indigo-800 mb-1.5">Importing lesson…</p>
              <div className="h-1.5 w-full bg-indigo-200 rounded-full overflow-hidden">
                <div
                  className="h-full w-2/5 bg-indigo-600 rounded-full"
                  style={{ animation: 'importProgress 1.5s ease-in-out infinite' }}
                />
              </div>
            </div>
          )}

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
                src={audioBlobUrl ?? undefined}
                onLoadedMetadata={() => {
                  if (audioRef.current != null && currentTime >= 0) {
                    audioRef.current.currentTime = currentTime
                  }
                }}
                onEnded={() => {
                  setIsPlaying(false)
                }}
                onError={(e) => {
                  console.error('Audio playback error:', e)
                  setIsPlaying(false)
                }}
              />
            )}

            <div className="flex items-center gap-4 mb-4">
              {/* Media Player */}
              <div className="flex-1 flex items-center gap-2">
                <button
                  onClick={() => {
                    if (currentSentenceIndex > 0) {
                      userInitiatedSentenceChangeRef.current = true
                      const prevIndex = currentSentenceIndex - 1
                      setCurrentSentenceIndex(prevIndex)
                      repeatCountRef.current = 0
                      if (audioRef.current && sentences[prevIndex]) {
                        audioRef.current.currentTime = sentences[prevIndex].start_time
                        setCurrentTime(sentences[prevIndex].start_time)
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
                    if (currentSentenceIndex >= sentences.length - 1) return
                    const nextIndex = currentSentenceIndex + 1
                    const nextSentence = sentences[nextIndex]
                    if (!nextSentence) return
                    userInitiatedSentenceChangeRef.current = true
                    // Cancel any pause-interval timeout so it doesn't fire after we skip
                    if (intervalTimeoutRef.current) {
                      clearTimeout(intervalTimeoutRef.current)
                      intervalTimeoutRef.current = null
                    }
                    isWaitingForPauseIntervalRef.current = false
                    repeatCountRef.current = 0
                    setCurrentSentenceIndex(nextIndex)
                    setCurrentTime(nextSentence.start_time)
                    if (audioRef.current) {
                      audioRef.current.currentTime = nextSentence.start_time
                      audioRef.current.play().catch(() => {})
                    }
                    setIsPlaying(true)
                  }}
                  disabled={currentSentenceIndex >= sentences.length - 1}
                  className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M4.555 5.168A1 1 0 003 6v8a1 1 0 001.555.832L10 11.202V14a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4A1 1 0 0011 6v2.798l-5.445-3.63z" />
                  </svg>
                </button>
                <div className="flex-1 flex items-center gap-2 min-w-0">
                  <div
                    className="flex-1 min-w-0 h-2 rounded-full overflow-hidden relative pointer-events-none"
                    aria-hidden
                  >
                    <div className="absolute inset-0 bg-gray-200 rounded-full" />
                    <div
                      className="absolute inset-y-0 left-0 bg-indigo-600 rounded-full origin-left"
                      style={{
                        width: `${totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0}%`,
                        transition: 'width 0.2s linear'
                      }}
                    />
                  </div>
                  <span className="text-sm text-gray-600 min-w-[3rem]">
                    {formatTime(currentTime)} / {formatTime(totalDuration)}
                    {sentenceCount > 0 && (
                      <span className="ml-2 text-gray-500 bg-gray-200 text-xs rounded-full px-2 py-1">
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
                  <span>Interval: {pauseInterval} sec</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[120px]">
                  {[0, 3, 5, 10].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setPauseInterval(sec)
                      }}
                      className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                        pauseInterval === sec ? 'bg-gray-100 font-semibold' : ''
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
                <div className="flex items-center gap-1" title="Correct keystrokes in this video">
                  <div className="w-3 h-3 bg-green-500 rounded-full" />
                  <span className="text-sm text-gray-700">{videoSessionScores.correctChars}</span>
                </div>
                <div className="flex items-center gap-1" title="Hints used in this video">
                  <div className="w-3 h-3 bg-yellow-500 rounded-full" />
                  <span className="text-sm text-gray-700">{videoSessionScores.hintCount}</span>
                </div>
                <div className="flex items-center gap-1" title="Incorrect keystrokes in this video">
                  <div className="w-3 h-3 bg-red-500 rounded-full" />
                  <span className="text-sm text-gray-700">{videoSessionScores.incorrectChars}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Text Input Panel - Per-word input */}
          <div className="flex-1 p-4 overflow-y-auto bg-white">
            {currentSentence ? (() => {
              // When fully correct: show sentence in bold green, no editing
              if (isCurrentSentenceFullyCorrect) {
                return (
                  <div className="max-w-4xl mx-auto">
                    <p className="flex mt-3 text-sm text-green-600/80">✔ Correct</p>
                    <div className="text-xl leading-relaxed font-bold text-green-600 flex flex-wrap items-baseline gap-x-2 gap-y-3" style={{ fontSize: '2.2em' }}>
                      {currentSentence.sentence_text}
                    </div>
                  </div>
                )
              }
              const words = currentSentence.sentence_text.split(/\s+/).filter(Boolean)
              return (
                <div className="max-w-4xl mx-auto">
                  <div className="text-xl leading-relaxed text-gray-900 flex flex-wrap items-baseline gap-x-2 gap-y-3">
                    {words.map((word, idx) => {
                      const isHintShown = wordHintIndex === idx
                      const value = isHintShown ? word : (wordInputs[idx] ?? '')
                      const underlineClass = getWordUnderlineClass(word, value)
                      return (
                        <span key={idx} className="inline-flex items-baseline">
                          <input
                            ref={(el) => {
                              if (!wordInputRefs.current) wordInputRefs.current = []
                              wordInputRefs.current[idx] = el
                            }}
                            type="text"
                            value={value}
                            onChange={(e) => {
                              const v = e.target.value
                              const prev = wordInputs[idx] ?? ''
                              // Count a wrong character event when the normalized prefix first diverges
                              if (v.length > prev.length) {
                                const targetNorm = normalizeWord(word)
                                const prevNorm = normalizeWord(prev)
                                const nextNorm = normalizeWord(v)
                                const prevOk = targetNorm.startsWith(prevNorm)
                                const nextOk = targetNorm.startsWith(nextNorm)
                                if (prevOk && !nextOk) {
                                  setWordErrorChars((prevArr) => {
                                    const nextArr = [...prevArr]
                                    while (nextArr.length <= idx) nextArr.push(0)
                                    nextArr[idx] = (nextArr[idx] ?? 0) + 1
                                    return nextArr
                                  })
                                  setVideoSessionScores((s) => ({ ...s, incorrectChars: s.incorrectChars + 1 }))
                                } else if (prevOk && nextOk) {
                                  setVideoSessionScores((s) => ({ ...s, correctChars: s.correctChars + 1 }))
                                }
                              }
                              if (isHintShown) {
                                setWordHintIndex(null)
                                setWordInputs((prev) => {
                                  const next = [...prev]
                                  while (next.length <= idx) next.push('')
                                  next[idx] = v
                                  return next
                                })
                                return
                              }
                              setWordInputs((prev) => {
                                const next = [...prev]
                                while (next.length <= idx) next.push('')
                                next[idx] = v
                                return next
                              })
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Backspace' && value.length === 0 && idx > 0) {
                                e.preventDefault()
                                wordInputRefs.current[idx - 1]?.focus()
                                return
                              }
                              if (e.key === ' ') {
                                e.preventDefault()
                                wordInputRefs.current[idx + 1]?.focus()
                                return
                              }
                              if (e.key === 'Tab') {
                                e.preventDefault()
                                if (wordHintIndex === idx) {
                                  setWordHintIndex(null)
                                  wordInputRefs.current[idx + 1]?.focus()
                                } else {
                                  const currentVal = wordInputs[idx] ?? ''
                                  const wordComplete = normalizeWord(currentVal) === normalizeWord(word)
                                  if (wordComplete) {
                                    wordInputRefs.current[idx + 1]?.focus()
                                  } else {
                                    setWordHintIndex(idx)
                                    setVideoSessionScores((s) => ({ ...s, hintCount: s.hintCount + 1 }))
                                    setWordHintUsed((prev) => {
                                      const next = [...prev]
                                      while (next.length <= idx) next.push(false)
                                      next[idx] = true
                                      return next
                                    })
                                  }
                                }
                                return
                              }
                              if (wordHintIndex === idx && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                                e.preventDefault()
                                const targetNorm = normalizeWord(word)
                                const keyNorm = normalizeWord(e.key)
                                const isCorrectFirstChar = targetNorm.length > 0 && targetNorm[0] === keyNorm[0]
                                setVideoSessionScores((s) =>
                                  isCorrectFirstChar
                                    ? { ...s, correctChars: s.correctChars + 1 }
                                    : { ...s, incorrectChars: s.incorrectChars + 1 }
                                )
                                setWordHintIndex(null)
                                setWordInputs((prev) => {
                                  const next = [...prev]
                                  while (next.length <= idx) next.push('')
                                  next[idx] = e.key
                                  return next
                                })
                              }
                            }}
                            className={`bg-transparent border-0 outline-none px-0.5 py-0 min-w-0 rounded-sm focus:shadow-[0_0_0_2px_rgba(251,191,36,0.5)] ${underlineClass} ${isHintShown ? 'text-gray-400' : 'text-gray-900'}`}
                            style={{ maxWidth: `${Math.max(2, word.length*1.2)}ch`, fontSize: '1.8em' }}
                            aria-label={`Word ${idx + 1}`}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          {idx < words.length - 1 ? '\u00A0' : null}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })() : (
              <div className="text-center text-gray-500 py-12">
                Select a lesson to start practicing
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Status bar - shortcuts */}
      <footer className="flex-shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-1.5 flex items-center justify-center gap-6 text-xs text-gray-600">
        <span><kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded font-mono">Enter</kbd> play / pause</span>
        <span><kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded font-mono">[</kbd> previous sentence</span>
        <span><kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded font-mono">]</kbd> next sentence</span>
        <span><kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded font-mono">Space</kbd> next word input</span>
      </footer>

      {/* Import Modal */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={runImportInBackground}
        defaultPlaylistId={selectedPlaylistId}
      />

      {/* Lesson History - bottom-right */}
      <LessonHistory
        videoId={selectedLesson?.video_id ?? null}
        isLessonFinished={
          sentences.length > 0 &&
          currentSentenceIndex >= sentences.length - 1 &&
          Boolean(isCurrentSentenceFullyCorrect)
        }
      />

      {/* Notifications */}
      <div className="fixed top-4 right-4 z-[60] space-y-2">
        {notifications.map((note) => (
          <div
            key={note.id}
            className={`min-w-[260px] rounded-lg shadow-lg border px-4 py-3 text-sm font-medium ${
              note.type === 'success'
                ? 'bg-green-50 text-green-800 border-green-200'
                : note.type === 'error'
                  ? 'bg-red-50 text-red-800 border-red-200'
                  : 'bg-indigo-50 text-indigo-800 border-indigo-200'
            }`}
            role="status"
          >
            {note.message}
          </div>
        ))}
      </div>
    </div>
  )
}
