"use client"

import { useState, useCallback } from "react"
import { uploadChunk, getAckedSeqNos } from "@/lib/api"

const STORAGE_KEY = "tp_pending_session"

// ─── localStorage helpers ────────────────────────────────────────────────────

export function saveSessionToStorage(sessionId: string): void {
  localStorage.setItem(STORAGE_KEY, sessionId)
}

export function clearSessionFromStorage(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function getPendingSessionId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

// ─── OPFS helpers ────────────────────────────────────────────────────────────

async function listOPFSChunks(
  sessionId: string,
): Promise<Array<{ seqNo: number; blob: Blob }>> {
  const root = await navigator.storage.getDirectory()
  let sessionDir: FileSystemDirectoryHandle
  try {
    sessionDir = await root.getDirectoryHandle(sessionId)
  } catch {
    return []
  }

  const files: Array<{ seqNo: number; blob: Blob }> = []
  for await (const [name, handle] of (sessionDir as any).entries()) {
    if (handle.kind !== "file") continue
    const match = name.match(/^chunk-(\d+)\.wav$/)
    if (!match) continue
    const seqNo = parseInt(match[1]!, 10)
    const file = await (handle as FileSystemFileHandle).getFile()
    files.push({ seqNo, blob: file })
  }
  return files.sort((a, b) => a.seqNo - b.seqNo)
}

function getDurationMsFromWav(blob: Blob): Promise<number> {
  return blob.arrayBuffer().then((buf) => {
    const view = new DataView(buf)
    // WAV header: sampleRate at offset 24, numChannels at 22, bitsPerSample at 34, dataSize at 40
    const sampleRate = view.getUint32(24, true)
    const numChannels = view.getUint16(22, true)
    const bitsPerSample = view.getUint16(34, true)
    const dataSize = view.getUint32(40, true)
    const bytesPerSample = (bitsPerSample / 8) * numChannels
    return Math.round((dataSize / (sampleRate * bytesPerSample)) * 1000)
  })
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface RecoveryState {
  pendingSessionId: string | null
  opfsChunkCount: number
  recovering: boolean
  uploadedCount: number
  done: boolean
  error: string | null
}

export function useOpfsReconciliation() {
  const [state, setState] = useState<RecoveryState>({
    pendingSessionId: null,
    opfsChunkCount: 0,
    recovering: false,
    uploadedCount: 0,
    done: false,
    error: null,
  })

  // Call once on mount — finds any pending session and counts its OPFS chunks
  const checkForPendingSession = useCallback(async () => {
    const sessionId = getPendingSessionId()
    if (!sessionId) return

    const chunks = await listOPFSChunks(sessionId)
    if (chunks.length === 0) {
      // Nothing in OPFS — session was probably fully uploaded before reload
      clearSessionFromStorage()
      return
    }

    setState((s) => ({ ...s, pendingSessionId: sessionId, opfsChunkCount: chunks.length }))
  }, [])

  // Re-upload every OPFS chunk that the server hasn't acked yet
  const recover = useCallback(async () => {
    const sessionId = getPendingSessionId()
    if (!sessionId) return

    setState((s) => ({ ...s, recovering: true, error: null, uploadedCount: 0 }))

    try {
      const [opfsChunks, ackedSeqNos] = await Promise.all([
        listOPFSChunks(sessionId),
        getAckedSeqNos(sessionId),
      ])

      const ackedSet = new Set(ackedSeqNos)
      const toUpload = opfsChunks.filter((c) => !ackedSet.has(c.seqNo))

      let uploaded = 0
      for (const chunk of toUpload) {
        const durationMs = await getDurationMsFromWav(chunk.blob)
        await uploadChunk({
          chunkId: crypto.randomUUID(),
          sessionId,
          seqNo: chunk.seqNo,
          blob: chunk.blob,
          durationMs,
        })
        uploaded++
        setState((s) => ({ ...s, uploadedCount: uploaded }))
      }

      clearSessionFromStorage()
      setState((s) => ({ ...s, recovering: false, done: true }))
    } catch (e) {
      setState((s) => ({ ...s, recovering: false, error: String(e) }))
    }
  }, [])

  const discard = useCallback(() => {
    clearSessionFromStorage()
    setState((s) => ({ ...s, pendingSessionId: null, opfsChunkCount: 0, done: false, error: null }))
  }, [])

  return { state, checkForPendingSession, recover, discard }
}
