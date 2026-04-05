"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { uploadChunk } from "@/lib/api"

const SAMPLE_RATE = 16000
const BUFFER_SIZE = 4096

export interface WavChunk {
  id: string
  seqNo: number
  blob: Blob
  duration: number
  timestamp: number
  opfsWritten: boolean
  serverAcked: boolean
  uploadError: boolean
}

export type RecorderStatus = "idle" | "requesting" | "recording"

// ─── WAV encoding ───────────────────────────────────────────────────────────

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeStr(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)   // PCM
  view.setUint16(22, 1, true)   // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const length = Math.round(input.length / ratio)
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const srcIndex = i * ratio
    const low = Math.floor(srcIndex)
    const high = Math.min(low + 1, input.length - 1)
    const frac = srcIndex - low
    output[i] = (input[low] ?? 0) * (1 - frac) + (input[high] ?? 0) * frac
  }
  return output
}

// ─── OPFS helpers ────────────────────────────────────────────────────────────

async function writeToOPFS(sessionId: string, seqNo: number, blob: Blob): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const sessionDir = await root.getDirectoryHandle(sessionId, { create: true })
  const fileHandle = await sessionDir.getFileHandle(
    `chunk-${String(seqNo).padStart(6, "0")}.wav`,
    { create: true },
  )
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
}

// ─── Hook ────────────────────────────────────────────────────────────────────

interface UseRecorderOptions {
  chunkDuration?: number  // seconds, default 5
  sessionId?: string
}

export function useRecorder({ chunkDuration = 5, sessionId }: UseRecorderOptions = {}) {
  const [status, setStatus] = useState<RecorderStatus>("idle")
  const [chunks, setChunks] = useState<WavChunk[]>([])
  const [elapsed, setElapsed] = useState(0)

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const samplesRef = useRef<Float32Array[]>([])
  const sampleCountRef = useRef(0)
  const seqNoRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const statusRef = useRef<RecorderStatus>("idle")
  const sessionIdRef = useRef<string | undefined>(sessionId)

  statusRef.current = status
  sessionIdRef.current = sessionId

  const chunkThreshold = SAMPLE_RATE * chunkDuration

  // Called each time a full chunk is ready
  const handleChunk = useCallback(async (blob: Blob, seqNo: number, duration: number) => {
    const chunkId = crypto.randomUUID()
    const chunk: WavChunk = {
      id: chunkId,
      seqNo,
      blob,
      duration,
      timestamp: Date.now(),
      opfsWritten: false,
      serverAcked: false,
      uploadError: false,
    }

    setChunks((prev) => [...prev, chunk])

    const sid = sessionIdRef.current
    if (!sid) return

    // 1. Write to OPFS first (durable local storage)
    try {
      await writeToOPFS(sid, seqNo, blob)
      setChunks((prev) =>
        prev.map((c) => (c.id === chunkId ? { ...c, opfsWritten: true } : c)),
      )
    } catch (err) {
      console.error("OPFS write failed for chunk", seqNo, err)
    }

    // 2. Upload to server
    try {
      await uploadChunk({
        chunkId,
        sessionId: sid,
        seqNo,
        blob,
        durationMs: Math.round(duration * 1000),
      })
      setChunks((prev) =>
        prev.map((c) => (c.id === chunkId ? { ...c, serverAcked: true } : c)),
      )
    } catch (err) {
      console.error("Server upload failed for chunk", seqNo, err)
      setChunks((prev) =>
        prev.map((c) => (c.id === chunkId ? { ...c, uploadError: true } : c)),
      )
    }
  }, [])

  // Merge buffered samples and emit a chunk
  const flushSamples = useCallback(
    (samples: Float32Array[]) => {
      if (samples.length === 0) return
      const totalLen = samples.reduce((n, b) => n + b.length, 0)
      const merged = new Float32Array(totalLen)
      let off = 0
      for (const buf of samples) {
        merged.set(buf, off)
        off += buf.length
      }
      const blob = encodeWav(merged, SAMPLE_RATE)
      const seqNo = seqNoRef.current++
      handleChunk(blob, seqNo, merged.length / SAMPLE_RATE)
    },
    [handleChunk],
  )

  const start = useCallback(async () => {
    if (statusRef.current === "recording") return

    setStatus("requesting")
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })

      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(mediaStream)
      const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1)
      const nativeSampleRate = audioCtx.sampleRate

      processor.onaudioprocess = (e) => {
        if (statusRef.current !== "recording") return
        const input = e.inputBuffer.getChannelData(0)
        const resampled = resample(new Float32Array(input), nativeSampleRate, SAMPLE_RATE)

        samplesRef.current.push(resampled)
        sampleCountRef.current += resampled.length

        if (sampleCountRef.current >= chunkThreshold) {
          const toFlush = samplesRef.current
          samplesRef.current = []
          sampleCountRef.current = 0
          flushSamples(toFlush)
        }
      }

      source.connect(processor)
      processor.connect(audioCtx.destination)

      streamRef.current = mediaStream
      audioCtxRef.current = audioCtx
      processorRef.current = processor
      seqNoRef.current = 0
      startTimeRef.current = Date.now()
      setElapsed(0)
      setChunks([])
      setStatus("recording")

      timerRef.current = setInterval(() => {
        if (statusRef.current === "recording") {
          setElapsed((Date.now() - startTimeRef.current) / 1000)
        }
      }, 100)
    } catch (err) {
      console.error("Failed to start recorder:", err)
      setStatus("idle")
    }
  }, [chunkThreshold, flushSamples])

  const stop = useCallback(() => {
    // Flush any remaining samples as the final chunk
    if (samplesRef.current.length > 0) {
      flushSamples(samplesRef.current)
      samplesRef.current = []
      sampleCountRef.current = 0
    }

    processorRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (audioCtxRef.current?.state !== "closed") {
      audioCtxRef.current?.close()
    }
    if (timerRef.current) clearInterval(timerRef.current)

    processorRef.current = null
    audioCtxRef.current = null
    streamRef.current = null
    setStatus("idle")
  }, [flushSamples])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      processorRef.current?.disconnect()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (audioCtxRef.current?.state !== "closed") {
        audioCtxRef.current?.close()
      }
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return { status, start, stop, chunks, elapsed }
}
