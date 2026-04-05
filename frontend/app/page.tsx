"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { listSessions, type SessionListItem } from "@/lib/api"

const STATUS_STYLES: Record<string, string> = {
  recording: "bg-blue-100 text-blue-700",
  transcribing: "bg-yellow-100 text-yellow-700",
  done: "bg-green-100 text-green-700",
  error: "bg-red-100 text-red-700",
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  const secs = Math.round((end - start) / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

export default function HomePage() {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Transcription Sessions</h1>
            <p className="text-sm text-gray-500 mt-1">
              Record audio, transcribe with speaker labels
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/upload"
              className="border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Upload File
            </Link>
            <Link
              href="/record"
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              + New Recording
            </Link>
          </div>
        </div>

        {loading && (
          <p className="text-gray-400 text-sm text-center py-12">Loading sessions…</p>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            Could not reach the API server. Make sure the backend is running on{" "}
            <code className="font-mono">localhost:8000</code>.
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No sessions yet.</p>
            <Link href="/record" className="text-blue-600 text-sm underline mt-2 inline-block">
              Start your first recording
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/sessions/${s.id}`}
              className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-gray-400 truncate">{s.id}</p>
                  <p className="text-sm text-gray-700 mt-1">
                    {new Date(s.started_at).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatDuration(s.started_at, s.ended_at)} &middot; {s.chunk_count} chunks
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium shrink-0 ${
                    STATUS_STYLES[s.status] ?? "bg-gray-100 text-gray-600"
                  }`}
                >
                  {s.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
