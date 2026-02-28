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

export async function getConfig(): Promise<Record<string, string>> {
  const { data } = await api.get<Record<string, string>>('/api/user/config')
  return data
}

export async function setConfig(config: Record<string, string | number | boolean | null>) {
  await api.put('/api/user/config', config)
}
