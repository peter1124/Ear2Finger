import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

export interface Playlist {
  id: number
  name: string
  created_at: string
  video_count: number
}

export interface Lesson {
  id: number
  video_id: number
  title: string
  duration: number
  sentence_count: number
  is_favorite?: boolean
  audio_file_path?: string
  youtube_url?: string
}

export interface Sentence {
  id: number
  sentence_text: string
  start_time: number
  end_time: number
  sentence_index: number
}

export interface VideoSessionScores {
  correctChars: number
  incorrectChars: number
  hintCount: number
}

interface WorkspaceState {
  playlists: Playlist[]
  selectedPlaylistId: number | null
  selectedLesson: Lesson | null
  lessons: Lesson[]
  sentences: Sentence[]
  sentencesVideoId: number | null
  currentSentenceIndex: number
  isPlaying: boolean
  currentTime: number
  playbackSpeed: number
  pauseInterval: number
  ignorePunctuation: boolean
  ignoreCase: boolean
  repeatCount: number | '∞'
  wordInputs: string[]
  wordHintIndex: number | null
  wordHintUsed: boolean[]
  wordErrorChars: number[]
  videoSessionScores: VideoSessionScores
}

const defaultScores: VideoSessionScores = {
  correctChars: 0,
  incorrectChars: 0,
  hintCount: 0,
}

const STORAGE_KEY = 'ear2finger-workspace-progress'

function loadPersistedState(): Partial<WorkspaceState> | null {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const initialState: WorkspaceState = {
  playlists: [],
  selectedPlaylistId: null,
  selectedLesson: null,
  lessons: [],
  sentences: [],
  sentencesVideoId: null,
  currentSentenceIndex: 0,
  isPlaying: false,
  currentTime: 0,
  playbackSpeed: 1,
  pauseInterval: 3,
  ignorePunctuation: true,
  ignoreCase: true,
  repeatCount: '∞',
  wordInputs: [],
  wordHintIndex: null,
  wordHintUsed: [],
  wordErrorChars: [],
  videoSessionScores: { ...defaultScores },
}

type WorkspaceContextValue = WorkspaceState & {
  setPlaylists: (v: Playlist[] | ((prev: Playlist[]) => Playlist[])) => void
  setSelectedPlaylistId: (v: number | null | ((prev: number | null) => number | null)) => void
  setSelectedLesson: (v: Lesson | null | ((prev: Lesson | null) => Lesson | null)) => void
  setLessons: (v: Lesson[] | ((prev: Lesson[]) => Lesson[])) => void
  setSentences: (v: Sentence[] | ((prev: Sentence[]) => Sentence[])) => void
  setSentencesVideoId: (v: number | null | ((prev: number | null) => number | null)) => void
  setCurrentSentenceIndex: (v: number | ((prev: number) => number)) => void
  setIsPlaying: (v: boolean | ((prev: boolean) => boolean)) => void
  setCurrentTime: (v: number | ((prev: number) => number)) => void
  setPlaybackSpeed: (v: number) => void
  setPauseInterval: (v: number) => void
  setIgnorePunctuation: (v: boolean) => void
  setIgnoreCase: (v: boolean) => void
  setRepeatCount: (v: number | '∞') => void
  setWordInputs: (v: string[] | ((prev: string[]) => string[])) => void
  setWordHintIndex: (v: number | null) => void
  setWordHintUsed: (v: boolean[] | ((prev: boolean[]) => boolean[])) => void
  setWordErrorChars: (v: number[] | ((prev: number[]) => number[])) => void
  setVideoSessionScores: (v: VideoSessionScores | ((prev: VideoSessionScores) => VideoSessionScores)) => void
  resetVideoSessionScores: () => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  // Load once per Provider mount so that when user navigates back (Provider may remount), we restore from latest sessionStorage.
  const [persistedSnapshot] = useState(loadPersistedState)
  const p = persistedSnapshot ?? {}

  const [playlists, setPlaylists] = useState<Playlist[]>(p.playlists ?? initialState.playlists)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(p.selectedPlaylistId ?? initialState.selectedPlaylistId)
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(p.selectedLesson ?? initialState.selectedLesson)
  const [lessons, setLessons] = useState<Lesson[]>(p.lessons ?? initialState.lessons)
  const [sentences, setSentences] = useState<Sentence[]>(p.sentences ?? initialState.sentences)
  const [sentencesVideoId, setSentencesVideoId] = useState<number | null>(p.sentencesVideoId ?? initialState.sentencesVideoId)
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(p.currentSentenceIndex ?? initialState.currentSentenceIndex)
  const [isPlaying, setIsPlaying] = useState(initialState.isPlaying)
  const [currentTime, setCurrentTime] = useState(p.currentTime ?? initialState.currentTime)
  const [playbackSpeed, setPlaybackSpeed] = useState(p.playbackSpeed ?? initialState.playbackSpeed)
  const [pauseInterval, setPauseInterval] = useState(p.pauseInterval ?? initialState.pauseInterval)
  const [ignorePunctuation, setIgnorePunctuation] = useState(p.ignorePunctuation ?? initialState.ignorePunctuation)
  const [ignoreCase, setIgnoreCase] = useState(p.ignoreCase ?? initialState.ignoreCase)
  const [repeatCount, setRepeatCount] = useState<number | '∞'>(p.repeatCount ?? initialState.repeatCount)
  const [wordInputs, setWordInputs] = useState<string[]>(p.wordInputs ?? initialState.wordInputs)
  const [wordHintIndex, setWordHintIndex] = useState<number | null>(initialState.wordHintIndex)
  const [wordHintUsed, setWordHintUsed] = useState<boolean[]>(p.wordHintUsed ?? initialState.wordHintUsed)
  const [wordErrorChars, setWordErrorChars] = useState<number[]>(p.wordErrorChars ?? initialState.wordErrorChars)
  const [videoSessionScores, setVideoSessionScores] = useState<VideoSessionScores>(p.videoSessionScores ?? { ...defaultScores })

  const resetVideoSessionScores = useCallback(() => {
    setVideoSessionScores({ ...defaultScores })
  }, [])

  useEffect(() => {
    try {
      const payload: WorkspaceState = {
        playlists,
        selectedPlaylistId,
        selectedLesson,
        lessons,
        sentences,
        sentencesVideoId,
        currentSentenceIndex,
        isPlaying,
        currentTime,
        playbackSpeed,
        pauseInterval,
        ignorePunctuation,
        ignoreCase,
        repeatCount,
        wordInputs,
        wordHintIndex,
        wordHintUsed,
        wordErrorChars,
        videoSessionScores,
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // ignore
    }
  }, [
    playlists,
    selectedPlaylistId,
    selectedLesson,
    lessons,
    sentences,
    sentencesVideoId,
    currentSentenceIndex,
    isPlaying,
    currentTime,
    playbackSpeed,
    pauseInterval,
    ignorePunctuation,
    ignoreCase,
    repeatCount,
    wordInputs,
    wordHintIndex,
    wordHintUsed,
    wordErrorChars,
    videoSessionScores,
  ])

  const value: WorkspaceContextValue = {
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
  }

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}
