export interface OPFSChunk {
  seqNo: number
  blob: Blob
  durationMs: number
}

/**
 * Read all WAV chunks for a session from OPFS.
 * Returns them sorted by seq number.
 * Returns empty array if the session directory doesn't exist.
 */
export async function readSessionFromOPFS(sessionId: string): Promise<OPFSChunk[]> {
  try {
    const root = await navigator.storage.getDirectory()
    const sessionDir = await root.getDirectoryHandle(sessionId)
    const chunks: OPFSChunk[] = []

    for await (const [name, handle] of sessionDir.entries()) {
      if (handle.kind !== "file") continue
      const match = name.match(/^chunk-(\d+)\.wav$/)
      if (!match) continue

      const seqNo = parseInt(match[1]!, 10)
      const file = await (handle as FileSystemFileHandle).getFile()

      // Calculate duration from WAV file size:
      // WAV header = 44 bytes, 16-bit samples = 2 bytes, sample rate = 16000 Hz
      const durationMs = Math.round(((file.size - 44) / 2 / 16000) * 1000)

      chunks.push({ seqNo, blob: file, durationMs })
    }

    return chunks.sort((a, b) => a.seqNo - b.seqNo)
  } catch {
    // Session directory doesn't exist in OPFS
    return []
  }
}

/**
 * Check whether a session has any chunks saved in OPFS.
 */
export async function sessionExistsInOPFS(sessionId: string): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory()
    await root.getDirectoryHandle(sessionId)
    return true
  } catch {
    return false
  }
}
