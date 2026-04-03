import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getLessonSessions,
  getCoachFeedback,
  type LessonSessionRecord,
  type CoachFeedbackResponse,
} from '../api'

function formatDate(d: string): string {
  const date = new Date(d)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(d: string): string {
  return new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function groupByDate(sessions: LessonSessionRecord[]): { dateLabel: string; sessions: LessonSessionRecord[] }[] {
  const byDate = new Map<string, LessonSessionRecord[]>()
  for (const s of sessions) {
    const key = new Date(s.started_at).toDateString()
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key)!.push(s)
  }
  const sortedKeys = Array.from(byDate.keys()).sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  )
  return sortedKeys.map((key) => ({
    dateLabel: formatDate(new Date(key).toISOString()),
    sessions: byDate.get(key)!,
  }))
}

interface LessonHistoryProps {
  videoId: number | null
  onResume?: (session: LessonSessionRecord) => void
  isLessonFinished?: boolean
}

export default function LessonHistory({ videoId, onResume, isLessonFinished }: LessonHistoryProps) {
  const [sessions, setSessions] = useState<LessonSessionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [coachOpen, setCoachOpen] = useState(false)
  const [activeSession, setActiveSession] = useState<LessonSessionRecord | null>(null)
  const [coachLoading, setCoachLoading] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)
  const [coachFeedback, setCoachFeedback] = useState<CoachFeedbackResponse | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!videoId) {
      setSessions([])
      return
    }
    setLoading(true)
    getLessonSessions(videoId)
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false))
  }, [videoId])

  const grouped = groupByDate(sessions)

  const handleAskCoach = (session: LessonSessionRecord) => {
    if (!videoId) return
    setCoachOpen(true)
    setActiveSession(session)
    setCoachLoading(true)
    setCoachError(null)
    setCoachFeedback(null)
    getCoachFeedback({
      video_id: videoId,
      from_date: session.started_at,
      to_date: session.ended_at ?? session.started_at,
    })
      .then((data) => {
        setCoachFeedback(data)
      })
      .catch((e) => {
        const err = e as { response?: { data?: { detail?: string } } }
        setCoachError(
          err.response?.data?.detail ||
            'AI coach is unavailable. Check your AI API key in Settings.'
        )
      })
      .finally(() => setCoachLoading(false))
  }

  return (
    <div className="fixed bottom-6 right-3 left-3 md:left-auto md:bottom-8 md:right-4 z-40 flex flex-col items-stretch md:items-end space-y-2">
      {coachOpen && (
        <div className="w-full max-w-sm md:w-80 max-h-[60vh] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl flex flex-col">
          <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-900 truncate">Ask coach about session</h2>
              {activeSession && (
                <p className="text-[11px] text-gray-500">
                  {formatDate(activeSession.started_at)} · {formatTime(activeSession.started_at)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCoachOpen(false)}
              className="p-1 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close coach panel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="px-3 py-2 text-xs text-gray-600 border-b border-gray-100">
            Feedback is based on your overall stats; date filters may be used in future versions.
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 text-sm">
            {coachError && (
              <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                {coachError}{' '}
                <button
                  type="button"
                  onClick={() => navigate('/settings')}
                  className="underline font-medium"
                >
                  Open AI settings
                </button>
              </div>
            )}
            {coachLoading && !coachFeedback && !coachError && (
              <p className="text-sm text-gray-600">Asking your AI coach…</p>
            )}
            {coachFeedback && (
              <>
                <p className="text-sm text-gray-700 whitespace-pre-line">
                  {coachFeedback.summary}
                </p>
                {coachFeedback.suggestions?.length > 0 && (
                  <ul className="space-y-2">
                    {coachFeedback.suggestions.map((s, i) => (
                      <li key={i} className="flex gap-2 text-sm text-gray-700">
                        <span className="mt-0.5 w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-medium">
                          {i + 1}
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {!coachLoading && !coachFeedback && !coachError && (
              <p className="text-sm text-gray-600">
                Connect an AI key in Settings and choose &ldquo;Ask coach&rdquo; on a session to see
                personalized tips.
              </p>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg bg-gray-800 text-white px-3 py-2 text-sm shadow-lg hover:bg-gray-700 self-end md:self-auto"
      >
        {open ? 'Hide History' : 'Lesson History'}
      </button>
      {open && (
        <div className="mt-1 w-full max-w-sm md:w-80 max-h-[min(60vh,400px)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl flex flex-col">
          <div className="p-2 border-b border-gray-200 font-medium text-gray-900 text-sm shrink-0">
            Lesson history
          </div>
          <div className="overflow-y-auto flex-1 p-2">
            {loading ? (
              <div className="text-gray-500 text-sm py-4 text-center">Loading…</div>
            ) : !videoId ? (
              <div className="text-gray-500 text-sm py-4 text-center">Select a lesson</div>
            ) : grouped.length === 0 ? (
              <div className="text-gray-500 text-sm py-4 text-center">No history yet</div>
            ) : (
              <div className="space-y-4">
                {grouped.map(({ dateLabel, sessions: daySessions }) => (
                  <div key={dateLabel}>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                      {dateLabel}
                    </div>
                    <ul className="space-y-2">
                      {daySessions.map((s) => (
                        <li
                          key={s.id}
                          className="text-sm border border-gray-100 rounded-md p-2 bg-gray-50/80"
                        >
                          <div className="flex justify-between items-center text-gray-600">
                            <span className="text-xs font-medium text-gray-500">
                              {formatTime(s.started_at)}
                            </span>
                            <div className="flex items-center gap-1">
                              {onResume && (
                                <button
                                  type="button"
                                  onClick={() => onResume?.(s)}
                                  className="inline-flex items-center rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
                                >
                                  <span className="mr-1">↺</span>
                                  Resume
                                </button>
                              )}
                              {isLessonFinished && (
                                <button
                                  type="button"
                                  onClick={() => handleAskCoach(s)}
                                  className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 transition-colors"
                                >
                                  Ask coach
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="flex mt-1 text-gray-700">
                            Practiced sentences: <strong>{s.sentences_practiced}</strong>
                          </div>
                          <div className="flex mt-1 text-xs justify-between">
                            <span className="text-green-600">Correct: {s.correct_chars}</span>
                            <span className="text-yellow-600">Hints: {s.hint_count}</span>
                            <span className="text-red-600">Incorrect: {s.incorrect_chars}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
