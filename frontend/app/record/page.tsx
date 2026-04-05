"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { createSession, triggerTranscription } from "@/lib/api"
import { useRecorder } from "@/hooks/use-recorder"

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export default function RecordPage() {
  const router = useRouter()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { status, start, stop, chunks, elapsed } = useRecorder({
    chunkDuration: 5,
    sessionId: sessionId ?? undefined,
  })

  const handleStart = useCallback(async () => {
    setStarting(true)
    setError(null)
    try {
      const id = await createSession()
      setSessionId(id)
      await start()
    } catch (e: unknown) {
      setError(String(e))
    } finally {
      setStarting(false)
    }
  }, [start])

  const handleStop = useCallback(() => {
    stop()
  }, [stop])

  const handleTranscribe = useCallback(async () => {
    if (!sessionId) return
    setTranscribing(true)
    setError(null)
    try {
      await triggerTranscription(sessionId)
      router.push(`/sessions/${sessionId}`)
    } catch (e: unknown) {
      setError(String(e))
      setTranscribing(false)
    }
  }, [sessionId, router])

  const isRecording = status === "recording"
  const isIdle = status === "idle"
  const hasStopped = isIdle && chunks.length > 0

  const ackedCount = chunks.filter((c) => c.serverAcked).length
  const errorCount = chunks.filter((c) => c.uploadError).length

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <h1 className="text-xl font-bold text-gray-900 mb-1">New Recording</h1>
        <p className="text-sm text-gray-500 mb-8">
          Audio is chunked every 5 seconds and saved locally + uploaded automatically.
        </p>

        {/* Timer */}
        <div className="text-center mb-6">
          <span className="text-5xl font-mono font-light text-gray-800 tabular-nums">
            {formatTime(elapsed)}
          </span>
          {isRecording && (
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-gray-500">Recording</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex gap-3 justify-center mb-8">
          {isIdle && !hasStopped && (
            <button
              onClick={handleStart}
              disabled={starting}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-6 py-3 rounded-lg transition-colors"
            >
              {starting ? "Preparing…" : "Start Recording"}
            </button>
          )}

          {isRecording && (
            <button
              onClick={handleStop}
              className="bg-red-500 hover:bg-red-600 text-white font-medium px-6 py-3 rounded-lg transition-colors"
            >
              Stop Recording
            </button>
          )}

          {hasStopped && (
            <>
              <button
                onClick={handleTranscribe}
                disabled={transcribing || ackedCount === 0}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium px-6 py-3 rounded-lg transition-colors"
              >
                {transcribing ? "Submitting…" : "Transcribe"}
              </button>
              <button
                onClick={() => {
                  setSessionId(null)
                  setError(null)
                }}
                className="border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium px-4 py-3 rounded-lg transition-colors"
              >
                Discard
              </button>
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        {/* Chunk list */}
        {chunks.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Chunks ({chunks.length})
              </p>
              <div className="flex gap-3 text-xs text-gray-400">
                <span className="text-green-600">{ackedCount} uploaded</span>
                {errorCount > 0 && (
                  <span className="text-red-500">{errorCount} failed</span>
                )}
              </div>
            </div>

            {/* Visual chunk timeline */}
            <div className="flex flex-wrap gap-1 mb-3">
              {chunks.map((c) => (
                <div
                  key={c.id}
                  title={`Chunk ${c.seqNo} — ${c.duration.toFixed(1)}s`}
                  className={`w-5 h-5 rounded text-[9px] flex items-center justify-center font-mono ${
                    c.uploadError
                      ? "bg-red-200 text-red-700"
                      : c.serverAcked
                        ? "bg-green-200 text-green-700"
                        : c.opfsWritten
                          ? "bg-yellow-200 text-yellow-700"
                          : "bg-gray-100 text-gray-400"
                  }`}
                >
                  {c.seqNo}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-green-200 inline-block" /> uploaded
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-yellow-200 inline-block" /> saved locally
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-red-200 inline-block" /> upload failed
              </span>
            </div>
          </div>
        )}

        {/* Session ID */}
        {sessionId && (
          <p className="text-xs text-gray-300 font-mono mt-4 truncate">
            session: {sessionId}
          </p>
        )}
      </div>
    </main>
  )
}
