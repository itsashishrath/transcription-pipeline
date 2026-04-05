"use client"

import { useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { uploadAudioFile } from "@/lib/api"

const ACCEPTED = [".mp3", ".wav", ".m4a", ".mp4", ".ogg", ".flac", ".webm"]
const ACCEPTED_MIME = "audio/*,video/mp4"

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileExt(name: string): string {
  return name.split(".").pop()?.toUpperCase() ?? "FILE"
}

export default function UploadPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback((f: File) => {
    setFile(f)
    setError(null)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const dropped = e.dataTransfer.files[0]
      if (dropped) handleFile(dropped)
    },
    [handleFile],
  )

  const handleSubmit = useCallback(async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const sessionId = await uploadAudioFile(file)
      router.push(`/sessions/${sessionId}`)
    } catch (e: unknown) {
      setError(String(e))
      setUploading(false)
    }
  }, [file, router])

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <Link href="/" className="text-sm text-blue-600 hover:underline mb-6 inline-block">
          ← All sessions
        </Link>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <h1 className="text-xl font-bold text-gray-900 mb-1">Upload Audio File</h1>
          <p className="text-sm text-gray-500 mb-6">
            Upload a pre-recorded file to transcribe with speaker labels.
            Supports {ACCEPTED.join(", ")}.
          </p>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
              dragging
                ? "border-blue-400 bg-blue-50"
                : file
                  ? "border-green-400 bg-green-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_MIME}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />

            {file ? (
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 bg-white border border-green-200 rounded-lg px-3 py-2">
                  <span className="text-xs font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                    {fileExt(file.name)}
                  </span>
                  <span className="text-sm text-gray-700 font-medium truncate max-w-xs">
                    {file.name}
                  </span>
                  <span className="text-xs text-gray-400">{formatBytes(file.size)}</span>
                </div>
                <p className="text-xs text-gray-400">Click to change file</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-gray-500 text-sm">
                  {dragging ? "Drop it here" : "Drag & drop an audio file, or click to browse"}
                </p>
                <p className="text-xs text-gray-400">{ACCEPTED.join(" · ")}</p>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!file || uploading}
            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium py-3 rounded-xl transition-colors"
          >
            {uploading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Uploading & transcribing…
              </span>
            ) : (
              "Upload & Transcribe"
            )}
          </button>

          {uploading && (
            <p className="text-xs text-center text-gray-400 mt-3">
              File is uploading. You&apos;ll be redirected to the review page automatically.
              Transcription may take a few minutes for long recordings.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
