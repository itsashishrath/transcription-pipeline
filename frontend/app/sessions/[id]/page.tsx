"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { getTranscript, retryTranscription, uploadChunk, type TranscriptResult, type Utterance } from "@/lib/api"
import { readSessionFromOPFS } from "@/lib/opfs"

const SPEAKER_COLORS: Record<string, string> = {
  A: "bg-blue-100 text-blue-700 border-blue-200",
  B: "bg-purple-100 text-purple-700 border-purple-200",
  C: "bg-green-100 text-green-700 border-green-200",
  D: "bg-orange-100 text-orange-700 border-orange-200",
  E: "bg-pink-100 text-pink-700 border-pink-200",
}

function speakerColor(speaker: string): string {
  return SPEAKER_COLORS[speaker] ?? "bg-gray-100 text-gray-700 border-gray-200"
}

function formatMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const m = Math.floor(totalSecs / 60)
  const s = totalSecs % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>()
  const [result, setResult] = useState<TranscriptResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryStatus, setRetryStatus] = useState<string | null>(null)

  const fetchTranscript = useCallback(async () => {
    try {
      const data = await getTranscript(id)
      setResult(data)
    } catch (e: unknown) {
      setError(String(e))
    }
  }, [id])

  useEffect(() => {
    fetchTranscript()
  }, [fetchTranscript])

  // Poll automatically while transcription is running
  useEffect(() => {
    if (!result) return
    if (result.status === "transcribing" || result.status === "recording") {
      const timer = setInterval(fetchTranscript, 3000)
      return () => clearInterval(timer)
    }
  }, [result, fetchTranscript])

  const handleRetry = useCallback(async () => {
    setRetrying(true)
    setRetryStatus("Checking server…")
    setError(null)
    try {
      const result = await retryTranscription(id)

      if (result.needs_reupload) {
        // Server lost temp files (reboot). Read chunks from OPFS and re-upload.
        setRetryStatus("Reading chunks from browser storage…")
        const opfsChunks = await readSessionFromOPFS(id)

        if (opfsChunks.length === 0) {
          throw new Error(
            "Chunks are not in browser storage either. The audio for this session cannot be recovered.",
          )
        }

        setRetryStatus(`Re-uploading ${opfsChunks.length} chunks to server…`)
        for (const chunk of opfsChunks) {
          await uploadChunk({
            chunkId: crypto.randomUUID(),
            sessionId: id,
            seqNo: chunk.seqNo,
            blob: chunk.blob,
            durationMs: chunk.durationMs,
          })
          setRetryStatus(
            `Re-uploading chunks… (${chunk.seqNo + 1} / ${opfsChunks.length})`,
          )
        }

        // Now retry — server has the files again
        setRetryStatus("Submitting to AssemblyAI…")
        await retryTranscription(id)
      }

      await fetchTranscript()
    } catch (e: unknown) {
      setError(String(e))
    } finally {
      setRetrying(false)
      setRetryStatus(null)
    }
  }, [id, fetchTranscript])

  const speakers = result
    ? [...new Set(result.utterances.map((u) => u.speaker))].sort()
    : []

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Back */}
        <Link href="/" className="text-sm text-blue-600 hover:underline mb-6 inline-block">
          ← All sessions
        </Link>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Session Transcript</h1>
            <p className="font-mono text-xs text-gray-400 mt-1 truncate max-w-sm">{id}</p>
          </div>

          {result && (
            <span
              className={`text-xs px-2 py-1 rounded-full font-medium ${
                result.status === "done"
                  ? "bg-green-100 text-green-700"
                  : result.status === "error"
                    ? "bg-red-100 text-red-700"
                    : "bg-yellow-100 text-yellow-700"
              }`}
            >
              {result.status}
            </span>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 mb-6">
            {error}
          </div>
        )}

        {!result && !error && (
          <div className="text-center py-20 text-gray-400 text-sm">Loading…</div>
        )}

        {result?.status === "transcribing" && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-700 mb-6 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shrink-0" />
            Transcription in progress — this page will update automatically.
          </div>
        )}

        {/* Error state with retry */}
        {result?.status === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-red-700">Transcription failed</p>
                <p className="text-xs text-red-500 mt-1">
                  {retryStatus
                    ? retryStatus
                    : "The audio chunks are still saved. You can retry — this will re-submit the same audio to AssemblyAI without re-recording."}
                </p>
              </div>
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="shrink-0 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
              >
                {retrying ? "Working…" : "Retry Transcription"}
              </button>
            </div>
          </div>
        )}

        {/* Speaker legend */}
        {speakers.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-6">
            {speakers.map((s) => (
              <span
                key={s}
                className={`text-xs px-2 py-1 rounded border font-medium ${speakerColor(s)}`}
              >
                Speaker {s}
              </span>
            ))}
          </div>
        )}

        {/* Utterances */}
        {result?.utterances && result.utterances.length > 0 && (
          <div className="space-y-3">
            {result.utterances.map((u: Utterance, i: number) => (
              <div key={i} className="flex gap-3">
                <span className="text-xs font-mono text-gray-300 pt-1 shrink-0 w-12">
                  {formatMs(u.start_ms)}
                </span>
                <div className="flex-1">
                  <span
                    className={`inline-block text-xs font-medium px-2 py-0.5 rounded border mb-1 ${speakerColor(u.speaker)}`}
                  >
                    Speaker {u.speaker}
                  </span>
                  <p className="text-sm text-gray-800 leading-relaxed">{u.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {result?.status === "done" && result.utterances.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No speech detected in the recording.
          </div>
        )}
      </div>
    </main>
  )
}
