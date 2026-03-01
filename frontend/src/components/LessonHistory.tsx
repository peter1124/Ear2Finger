import { useState, useEffect } from 'react'
import { getLessonSessions, type LessonSessionRecord } from '../api'

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
  onResume?: () => void
  isLessonFinished?: boolean
}

export default function LessonHistory({ videoId, onResume, isLessonFinished }: LessonHistoryProps) {
  const [sessions, setSessions] = useState<LessonSessionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

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
  const hasIncomplete = sessions.some((s) => s.ended_at == null)
  const showResume = hasIncomplete && !isLessonFinished && onResume

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg bg-gray-800 text-white px-3 py-2 text-sm shadow-lg hover:bg-gray-700"
      >
        {open ? 'Hide History' : 'Lesson History'}
      </button>
      {open && (
        <div className="mt-2 w-80 max-h-[min(60vh,400px)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl flex flex-col">
          <div className="p-2 border-b border-gray-200 font-medium text-gray-900 text-sm shrink-0">
            Session history
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
                {showResume && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={onResume}
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      Resume
                    </button>
                  </div>
                )}
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
                            <span>{formatTime(s.started_at)}</span>
                            {s.ended_at == null && (
                              <span className="text-amber-600 text-xs font-medium">In progress</span>
                            )}
                          </div>
                          <div className="mt-1 text-gray-700">
                            Sentences: <strong>{s.sentences_practiced}</strong>
                          </div>
                          <div className="flex gap-3 mt-1 text-xs">
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
