const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// ─── Sessions ──────────────────────────────────────────────────────────────

export interface SessionListItem {
  id: string
  started_at: string
  ended_at: string | null
  status: string
  chunk_count: number
}

export async function createSession(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/sessions`, { method: "POST" })
  if (!res.ok) throw new Error("Failed to create session")
  const data = await res.json()
  return data.id as string
}

export async function listSessions(): Promise<SessionListItem[]> {
  const res = await fetch(`${API_BASE}/api/sessions`)
  if (!res.ok) throw new Error("Failed to list sessions")
  return res.json()
}

// ─── Chunks ────────────────────────────────────────────────────────────────

export interface UploadChunkParams {
  chunkId: string
  sessionId: string
  seqNo: number
  blob: Blob
  durationMs: number
}

export async function uploadChunk(params: UploadChunkParams): Promise<void> {
  const form = new FormData()
  form.append("audio", params.blob, `chunk-${params.seqNo}.wav`)
  form.append("chunk_id", params.chunkId)
  form.append("session_id", params.sessionId)
  form.append("seq_no", String(params.seqNo))
  form.append("duration_ms", String(params.durationMs))

  const res = await fetch(`${API_BASE}/api/chunks/upload`, {
    method: "POST",
    body: form,
  })
  if (!res.ok) throw new Error(`Chunk upload failed: ${res.status}`)
}

// ─── Transcription ─────────────────────────────────────────────────────────

export interface RetryResult {
  ok: boolean
  needs_reupload?: boolean
  message?: string
}

export async function retryTranscription(sessionId: string): Promise<RetryResult> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/retry`, {
    method: "POST",
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? "Failed to retry transcription")
  }
  return res.json()
}

export async function uploadAudioFile(file: File): Promise<string> {
  const form = new FormData()
  form.append("audio", file, file.name)
  const res = await fetch(`${API_BASE}/api/sessions/from-file`, {
    method: "POST",
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? "Upload failed")
  }
  const data = await res.json()
  return data.id as string
}

export async function triggerTranscription(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/transcribe`, {
    method: "POST",
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? "Failed to start transcription")
  }
}

export interface Utterance {
  speaker: string
  start_ms: number
  end_ms: number
  text: string
}

export interface TranscriptResult {
  status: string
  utterances: Utterance[]
}

export async function getTranscript(sessionId: string): Promise<TranscriptResult> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/transcript`)
  if (!res.ok) throw new Error("Failed to fetch transcript")
  return res.json()
}
