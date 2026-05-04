/**
 * API client with auth. Uses relative /api so Vite proxy forwards to backend.
 * Attaches Bearer token from localStorage when present.
 */
import axios from 'axios'

const getToken = () => localStorage.getItem('ear2finger_token')

export const api = axios.create({
  baseURL: '',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ear2finger_token')
      localStorage.removeItem('ear2finger_user')
      // Let the app (AuthContext) handle redirect; avoid redirecting on every 401 if we're already on login
      const path = window.location.pathname || ''
      if (!path.startsWith('/login') && !path.startsWith('/register')) {
        window.dispatchEvent(new CustomEvent('auth:logout'))
      }
    }
    return Promise.reject(err)
  }
)

export interface UserInfo {
  id: number
  username: string
  email: string | null
  is_superuser?: boolean
  created_at: string | null
}

export interface AdminUser {
  id: number
  username: string
  email: string | null
  is_superuser: boolean
  created_at: string | null
}

export interface DistributionStats {
  mean: number
  variance: number
  p25: number
  p50: number
  p75: number
}

export interface WordStat {
  word: string
  total_count: number
  incorrect_count: number
  hint_count: number
  incorrect_rate: number
  hint_rate: number
  error_char_count: number
  error_char_rate: number
  average_spell_retry_times: number
  latest_spell_retry_times: number
}

export interface DailyUserStats {
  date: string
  total_videos_practiced: number
  total_sentences_practiced: number
  total_attempts: number
  total_words_seen: number
  unique_words_seen: number
  total_incorrect_words: number
  total_hints_used: number
  sentence_error_rate?: DistributionStats | null
  sentence_hint_usage?: DistributionStats | null
  sentence_length_words?: DistributionStats | null
  word_length_chars?: DistributionStats | null
}

export interface UserStats {
  total_videos_practiced: number
  total_sentences_practiced: number
  total_attempts: number
  total_words_seen: number
  unique_words_seen: number
  total_incorrect_words: number
  total_hints_used: number
  sentence_error_rate?: DistributionStats | null
  sentence_hint_usage?: DistributionStats | null
  sentence_length_words?: DistributionStats | null
  word_length_chars?: DistributionStats | null
  top_incorrect_words: WordStat[]
  top_hint_words: WordStat[]
  daily: DailyUserStats[]
}

export async function listUsers(): Promise<AdminUser[]> {
  const { data } = await api.get<AdminUser[]>('/api/users')
  return data
}

export async function createUser(body: { username: string; password: string; email?: string; is_superuser?: boolean }): Promise<AdminUser> {
  const { data } = await api.post<AdminUser>('/api/users', body)
  return data
}

export async function updateUser(
  userId: number,
  body: { username?: string; email?: string; password?: string; is_superuser?: boolean }
): Promise<AdminUser> {
  const { data } = await api.put<AdminUser>(`/api/users/${userId}`, body)
  return data
}

export async function deleteUser(userId: number): Promise<void> {
  await api.delete(`/api/users/${userId}`)
}

const AUTH_TIMEOUT_MS = 15_000

export async function getUserStats(): Promise<UserStats> {
  const { data } = await api.get<UserStats>('/api/user/stats')
  return data
}

export async function login(username: string, password: string): Promise<{ access_token: string; user: UserInfo }> {
  const { data } = await api.post<{ access_token: string; user: UserInfo }>(
    '/api/auth/login',
    { username, password },
    { timeout: AUTH_TIMEOUT_MS }
  )
  return data
}

export async function register(
  username: string,
  password: string,
  email?: string
): Promise<{ access_token: string; user: UserInfo }> {
  const { data } = await api.post<{ access_token: string; user: UserInfo }>(
    '/api/auth/register',
    { username, password, email: email || null },
    { timeout: AUTH_TIMEOUT_MS }
  )
  return data
}

export async function fetchMe(): Promise<UserInfo> {
  const { data } = await api.get<UserInfo>('/api/auth/me')
  return data
}

/** This app only supports Google Gemini for LLM and embeddings. */
export type AIProvider = 'gemini'

export interface AIConfig {
  ai_provider: AIProvider
  has_gemini_api_key: boolean
}

export interface SetConfigPayload {
  ai_provider?: AIProvider
  gemini_api_key?: string | null
  // Allow future non-AI config keys without tightening this type too much
  [key: string]: string | number | boolean | null | undefined
}

export async function getConfig(): Promise<AIConfig> {
  const { data } = await api.get<AIConfig>('/api/user/config')
  return data
}

export async function setConfig(config: SetConfigPayload) {
  await api.put('/api/user/config', config)
}

export interface AIKeyHint {
  id: string
  provider: AIProvider
  last4: string
  created_at: string
  is_active: boolean
}

export interface ListAIKeysResponse {
  provider: AIProvider
  ai_provider: string | null
  keys: AIKeyHint[]
}

export async function listAIKeys(): Promise<ListAIKeysResponse> {
  const { data } = await api.get<ListAIKeysResponse>('/api/user/ai-keys', {
    params: { provider: 'gemini' satisfies AIProvider },
  })
  return data
}

export async function addAIKey(key: string, makeActive = true): Promise<AIKeyHint> {
  const { data } = await api.post<AIKeyHint>('/api/user/ai-keys', {
    provider: 'gemini' satisfies AIProvider,
    key,
    make_active: makeActive,
  })
  return data
}

export async function activateAIKey(keyId: string): Promise<void> {
  await api.post('/api/user/ai-keys/' + encodeURIComponent(keyId) + '/activate', null, {
    params: { provider: 'gemini' satisfies AIProvider },
  })
}

export async function deleteAIKey(keyId: string): Promise<void> {
  await api.delete('/api/user/ai-keys/' + encodeURIComponent(keyId), {
    params: { provider: 'gemini' satisfies AIProvider },
  })
}

export interface LessonSessionRecord {
  id: number
  video_id: number
  started_at: string
  ended_at: string | null
  sentences_practiced: number
  correct_chars: number
  hint_count: number
  incorrect_chars: number
}

export async function getLessonSessions(videoId: number): Promise<LessonSessionRecord[]> {
  const { data } = await api.get<LessonSessionRecord[]>(`/api/lessons/${videoId}/sessions`)
  return data
}

export async function saveLessonSession(body: {
  video_id: number
  started_at: string
  ended_at?: string | null
  sentences_practiced: number
  correct_chars: number
  hint_count: number
  incorrect_chars: number
}): Promise<LessonSessionRecord> {
  const { data } = await api.post<LessonSessionRecord>('/api/user/lesson-sessions', body)
  return data
}

export async function upsertCurrentLessonSession(body: {
  video_id: number
  started_at: string
  ended_at?: string | null
  sentences_practiced: number
  correct_chars: number
  hint_count: number
  incorrect_chars: number
}): Promise<LessonSessionRecord> {
  const { data } = await api.put<LessonSessionRecord>('/api/user/lesson-sessions/current', body)
  return data
}

export interface CoachFeedbackRequest {
  video_id?: number | null
  from_date?: string | null
  to_date?: string | null
}

export interface CoachFeedbackResponse {
  summary: string
  suggestions: string[]
}

export async function getCoachFeedback(
  body: CoachFeedbackRequest = {}
): Promise<CoachFeedbackResponse> {
  const { data } = await api.post<CoachFeedbackResponse>('/api/ai/coach/feedback', body)
  return data
}

export interface PracticeRecommendationItem {
  sentence_id: number
  video_id: number
  sentence_text: string
  start_time: number
  end_time: number
  video_title?: string | null
   youtube_url?: string | null
  score: number
  reasons: string[]
}

export interface CoachRecommendPracticeResponse {
  recommendations: PracticeRecommendationItem[]
}

export async function getCoachRecommendations(body: {
  video_id?: number | null
  limit?: number
} = {}): Promise<CoachRecommendPracticeResponse> {
  const { data } = await api.post<CoachRecommendPracticeResponse>(
    '/api/ai/coach/recommend-practice',
    {
      limit: 10,
      ...body,
    }
  )
  return data
}

export async function createPlaylist(name: string): Promise<{ id: number; name: string; created_at: string; video_count: number }> {
  const { data } = await api.post('/api/playlists', { name })
  return data
}

export async function updatePlaylist(playlistId: number, name: string): Promise<{ id: number; name: string; created_at: string; video_count: number }> {
  const { data } = await api.patch(`/api/playlists/${playlistId}`, { name })
  return data
}

export async function deletePlaylist(playlistId: number): Promise<void> {
  await api.delete(`/api/playlists/${playlistId}`)
}

export async function removeVideoFromPlaylist(playlistId: number, videoId: number): Promise<void> {
  await api.delete(`/api/playlists/${playlistId}/videos/${videoId}`)
}

export async function deleteVideo(videoId: number): Promise<void> {
  await api.delete(`/api/youtube/videos/${videoId}`)
}
