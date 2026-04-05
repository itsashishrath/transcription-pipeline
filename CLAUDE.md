# Transcription Pipeline — Session Handoff

Read this file at the start of every session before doing any work.

---

## What This Project Is

A hackathon assignment. The goal is a **reliable audio recording and transcription pipeline** that:
- Records 1–2 hour audio sessions in a browser
- Never loses a single audio chunk even if the network drops or the tab closes
- Transcribes the full session using AssemblyAI with **speaker diarization** (Speaker A, Speaker B, etc.)
- Shows a reviewer the full transcript and which chunks were captured vs missed

This is a **standalone project** — nothing is imported from any other repo.

---

## Requirements (from the hackathon team)

### Core: Audio Capture
- Continuous recording up to 2 hours without interruption
- Audio split into fixed-duration chunks (currently 5 seconds each)
- No audio lost between chunk boundaries — each chunk ends where the next begins

### Core: Durability — No Data Loss
- Each chunk written to **OPFS (Origin Private File System)** in the browser before any network call
- If network drops / tab closes / upload fails → chunk survives in OPFS
- A chunk is only "safe" once: (1) confirmed in server temp storage AND (2) acknowledged in DB

### Core: Upload Reliability
- Every chunk must eventually reach the server even after network interruptions or tab reopen
- On page reload: scan OPFS for any chunks not yet acked → re-upload automatically

### Core: Transcription
- After session ends, server concatenates all WAV chunks in sequence order
- Sends combined audio to AssemblyAI for **batch transcription** (not real-time)
- AssemblyAI returns speaker-diarized utterances: Speaker A / B / C with timestamps
- Results stored in DB, shown in review UI

### Core: Review
- Reviewer can see all chunks with status (uploaded / missing / failed)
- Transcript shown with Speaker labels and timestamps
- Gaps in sequence numbers = missing audio = highlighted

### Fallback (not yet built)
- If upload pipeline failed: user plays original audio through speakers
- System listens via mic and re-captures → same chunking pipeline
- Review can then compare original vs fallback session

### Non-functional
- Sessions up to 2 hours, no degradation
- Zero silent failures — every failure must be visible in the UI
- Retry and reconciliation must be automatic, no manual user action

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 + Tailwind CSS | Already bootstrapped |
| Backend | FastAPI (Python) | Team comfortable with Python for debugging |
| Database | PostgreSQL + SQLAlchemy | Same Postgres instance as RevisionAgent (shared) |
| Transcription | AssemblyAI REST API (raw requests, not SDK) | SDK had deprecated `speech_model` field — REST API uses `speech_models` |
| Audio capture | `getUserMedia` + `ScriptProcessorNode` | Browser mic, no LiveKit needed (single location recording) |
| Local durability | OPFS (Origin Private File System) | Browser-native, survives tab close |
| Server temp storage | Local disk (`/tmp/transcription_pipeline/`) | No S3/MinIO — hackathon scope |

**Why no LiveKit:** LiveKit is for multi-party WebRTC rooms. This project records a physical room with one browser. AssemblyAI speaker diarization identifies speakers from the audio content — no separate tracks needed.

---

## Database

Uses the **same Postgres instance as RevisionAgent**: `revision_agent_temp` database.

Connection string (already in `backend/.env`):
```
DATABASE_URL=postgresql://postgres:Ashish%40123@127.0.0.1:5432/revision_agent_temp
```

### Tables (created automatically on server startup)

**`sessions`**
| Column | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| started_at | DateTime | auto |
| ended_at | DateTime | nullable, set when transcribe is triggered |
| status | String | `recording` → `transcribing` → `done` / `error` |

**`chunks`**
| Column | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| session_id | String | FK → sessions |
| seq_no | Integer | 0-indexed, order matters for concatenation |
| duration_ms | Integer | length of this chunk |
| acked_at | DateTime | when server received it |

**`utterances`**
| Column | Type | Notes |
|---|---|---|
| id | String (UUID) | PK |
| session_id | String | FK → sessions |
| speaker | String | "A", "B", "C" from AssemblyAI |
| start_ms | Integer | start time in ms from session start |
| end_ms | Integer | end time in ms |
| text | String | transcribed text |

---

## API Endpoints

Base URL: `http://localhost:8000`

| Method | Path | What it does |
|---|---|---|
| GET | `/` | Health check |
| POST | `/api/sessions` | Create session → returns `{id, started_at, status}` |
| GET | `/api/sessions` | List all sessions with chunk counts |
| POST | `/api/chunks/upload` | Receive WAV chunk (multipart) + metadata → save to `/tmp` + ack DB |
| POST | `/api/sessions/{id}/transcribe` | Concatenate chunks → upload to AssemblyAI → background polling → store utterances |
| GET | `/api/sessions/{id}/transcript` | Return `{status, utterances[]}` — poll until `status === "done"` |

### `/api/chunks/upload` form fields
- `audio` — WAV file binary
- `chunk_id` — UUID (generated client-side)
- `session_id` — UUID from session creation
- `seq_no` — integer, 0-indexed
- `duration_ms` — integer

---

## Project Structure

```
transcription-pipeline/
├── CLAUDE.md               ← this file
├── README.md               ← quick start
│
├── backend/
│   ├── main.py             ← FastAPI app entry point, creates DB tables on startup
│   ├── database.py         ← SQLAlchemy engine + SessionLocal + Base
│   ├── models.py           ← Session, Chunk, Utterance ORM models
│   ├── schemas.py          ← Pydantic request/response shapes
│   ├── requirements.txt    ← fastapi, uvicorn, sqlalchemy, psycopg2-binary, requests, python-dotenv, python-multipart
│   ├── .env                ← DATABASE_URL, ASSEMBLYAI_API_KEY, CORS_ORIGIN, TEMP_DIR
│   ├── .env.example        ← template
│   ├── .venv/              ← Python virtual environment (do not edit)
│   ├── routes/
│   │   ├── sessions.py     ← POST/GET /api/sessions
│   │   ├── chunks.py       ← POST /api/chunks/upload
│   │   └── transcripts.py  ← POST /api/sessions/{id}/transcribe, GET transcript
│   └── services/
│       └── assemblyai.py   ← raw REST calls to AssemblyAI (upload → transcribe → poll)
│
└── frontend/
    ├── .env.local          ← NEXT_PUBLIC_API_URL=http://localhost:8000
    ├── app/
    │   ├── page.tsx        ← home: list sessions, link to /record
    │   ├── record/
    │   │   └── page.tsx    ← recorder UI: start/stop, chunk status grid, transcribe button
    │   └── sessions/[id]/
    │       └── page.tsx    ← review: transcript with Speaker A/B labels, polls until done
    ├── hooks/
    │   └── use-recorder.ts ← audio capture + WAV encoding + OPFS write + server upload
    └── lib/
        └── api.ts          ← typed fetch wrappers for all backend endpoints
```

---

## How to Run

### Backend
```bash
cd backend
.venv/Scripts/uvicorn main:app --reload --port 8000
# Windows: .venv\Scripts\uvicorn main:app --reload --port 8000
```
Tables are created automatically on first run.

### Frontend
```bash
cd frontend
npm run dev
# runs on http://localhost:3000
```

---

## Current State (as of this session)

### Done and working
- [x] DB schema — all 3 tables created and verified against live Postgres
- [x] All FastAPI routes implemented
- [x] AssemblyAI integration — uses raw REST API with `speech_models: ["universal-3-pro", "universal-2"]` and `speaker_labels: true`
- [x] Frontend recorder hook — mic capture, 16kHz resampling, 5s WAV chunks, OPFS write, server upload
- [x] Home page — lists sessions with status badges
- [x] Record page — timer, chunk status grid (green=uploaded, yellow=OPFS only, red=failed), transcribe button
- [x] Review page — polls transcript, shows Speaker A / B utterances with timestamps
- [x] End-to-end tested: session created → chunks uploaded → transcription triggered → utterances returned

### Known bug fixed this session
- AssemblyAI Python SDK (`assemblyai` package) was sending deprecated `speech_model` field.
  **Fix:** Replaced SDK with raw `requests` calls in `backend/services/assemblyai.py`.
  The SDK package was removed from `requirements.txt` (replaced with `requests`).

### Not yet built (future work)
- [ ] OPFS reconciliation on page reload — scan for unacked chunks and re-upload automatically
- [ ] Retry queue for failed uploads (currently just marks `uploadError: true`)
- [ ] Chunk gap detection in review UI (missing seq_no = missing audio = red gap)
- [ ] Fallback mode (play audio → re-capture via mic → same pipeline)
- [ ] Session duration cap enforcement (2 hour warning)

---

## Key Implementation Decisions

| Decision | Reason |
|---|---|
| No LiveKit | Single browser recording a physical room. LiveKit adds WebRTC room complexity with no benefit here. Speaker ID comes from AssemblyAI, not separate tracks. |
| No S3/MinIO | Hackathon scope. Server stores chunks in `/tmp/transcription_pipeline/{session_id}/` and cleans up after transcription. |
| Batch transcription, not real-time | Team requirement. All chunks concatenated first, then one AssemblyAI job for the whole session. Enables better speaker diarization continuity across the full session. |
| Raw REST instead of AssemblyAI SDK | SDK `assemblyai 0.59.0` sends deprecated `speech_model` field. Raw requests give full control. |
| `Base.metadata.create_all()` on startup | Hackathon scope. No Alembic migrations. Tables created automatically if they don't exist. |
| Shared Postgres DB | Uses same `revision_agent_temp` DB as RevisionAgent. Tables are prefixed by purpose and don't conflict. |

---

## AssemblyAI Integration Detail

File: `backend/services/assemblyai.py`

Flow:
1. POST audio bytes to `https://api.assemblyai.com/v2/upload` → get `upload_url`
2. POST to `https://api.assemblyai.com/v2/transcript` with:
   ```json
   {
     "audio_url": "<upload_url>",
     "speech_models": ["universal-3-pro", "universal-2"],
     "speaker_labels": true,
     "language_code": "en"
   }
   ```
3. Poll `GET /v2/transcript/{id}` every 3 seconds until `status === "completed"`
4. Extract `utterances[]` → each has `speaker`, `start`, `end`, `text`

API key is in `backend/.env` as `ASSEMBLYAI_API_KEY`.

---

## Frontend Chunk Lifecycle

Each 5-second WAV chunk goes through these states (visible in the recorder UI):

```
captured (in memory)
    → opfsWritten: true    (grey → yellow in UI)
    → serverAcked: true    (yellow → green in UI)
    → uploadError: true    (red in UI — needs retry)
```

The `use-recorder.ts` hook manages this. For each chunk:
1. Emit chunk to React state immediately
2. `writeToOPFS(sessionId, seqNo, blob)` → marks `opfsWritten`
3. `uploadChunk(...)` POST to server → marks `serverAcked`
4. On failure → marks `uploadError`

Sequence number (`seqNo`) starts at 0 and increments. The server saves files as `chunk_000000.wav`, `chunk_000001.wav` etc. Concatenation is done by sorting these filenames.
