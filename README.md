# Transcription Pipeline

A reliable browser-based audio recording and transcription system. Record sessions up to 2 hours, survive network drops or tab closes without losing a single audio chunk, and get a fully speaker-diarized transcript powered by AssemblyAI.

---

## How It Works

```
Browser mic
    → 5-second WAV chunks
        → saved to OPFS (browser storage, survives tab close)
            → uploaded to FastAPI server
                → acknowledged in PostgreSQL
                                            ↓ (when you click "Transcribe")
                        all chunks concatenated in sequence order
                                            ↓
                                    AssemblyAI (batch)
                                            ↓
                        Speaker A / Speaker B / Speaker C utterances
                                            ↓
                                    stored in DB → shown in review UI
```

**Key guarantee:** a chunk is only considered safe once it is (1) on the server disk AND (2) acknowledged in the database. If upload fails mid-session, the chunk stays in OPFS and can be re-uploaded.

---

## Features

- **Continuous recording** — up to 2 hours, no degradation
- **Zero data loss** — every chunk written to OPFS before any network call
- **Chunk status grid** — green (uploaded), yellow (OPFS only), red (failed) in real time
- **Speaker diarization** — AssemblyAI identifies Speaker A, Speaker B, etc. from audio content
- **Review UI** — full transcript with speaker labels, timestamps, and chunk coverage
- **Automatic table creation** — no manual DB migrations needed

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 + Tailwind CSS |
| Backend | FastAPI (Python) |
| Database | PostgreSQL + SQLAlchemy |
| Transcription | AssemblyAI REST API |
| Local durability | OPFS (Origin Private File System) |
| Server temp storage | Local disk (`/tmp/transcription_pipeline/`) |

---

## Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.9+
- **PostgreSQL** running locally
- **AssemblyAI API key** — free to get at [assemblyai.com](https://www.assemblyai.com/) (free tier available, no credit card required)

---

## Setup

### 1. Clone the repo

```bash
git clone <repo-url>
cd transcription-pipeline
```

### 2. Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
```

Edit `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:yourpassword@127.0.0.1:5432/your_database
ASSEMBLYAI_API_KEY=your_assemblyai_key_here
CORS_ORIGIN=http://localhost:3000
TEMP_DIR=/tmp/transcription_pipeline
```

> **AssemblyAI API key is free.** Sign up at [assemblyai.com](https://www.assemblyai.com/), go to your dashboard, and copy the API key. No credit card required for the free tier.

Start the backend:

```bash
# Windows
.venv\Scripts\uvicorn main:app --reload --port 8000

# macOS/Linux
uvicorn main:app --reload --port 8000
```

The server starts at `http://localhost:8000`. Database tables are created automatically on first run.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

The app is available at `http://localhost:3000`.

---

## Usage

### Record a session

1. Open `http://localhost:3000`
2. Click **New Recording** — you will be prompted for microphone access
3. Recording begins immediately in 5-second chunks
4. Watch the chunk grid — squares turn green as each chunk is confirmed on the server
5. Click **Stop** when done
6. Click **Transcribe** to send the session to AssemblyAI

### Review the transcript

- The review page polls automatically until transcription completes
- Utterances are shown with speaker labels (Speaker A, Speaker B, …) and timestamps
- Any missed/failed chunks are visible in the chunk grid

---

## API Reference

Base URL: `http://localhost:8000`

| Method | Path | Description |
|---|---|---|
| GET | `/` | Health check |
| POST | `/api/sessions` | Create a new recording session |
| GET | `/api/sessions` | List all sessions with chunk counts |
| POST | `/api/chunks/upload` | Upload a WAV chunk (multipart) |
| POST | `/api/sessions/{id}/transcribe` | Start transcription for a session |
| GET | `/api/sessions/{id}/transcript` | Poll transcript status and utterances |

### Chunk upload fields

| Field | Type | Description |
|---|---|---|
| `audio` | file | WAV binary |
| `chunk_id` | string | UUID generated client-side |
| `session_id` | string | UUID from session creation |
| `seq_no` | integer | 0-indexed chunk position |
| `duration_ms` | integer | Length of this chunk in milliseconds |

---

## Project Structure

```
transcription-pipeline/
├── backend/
│   ├── main.py               # FastAPI app, creates DB tables on startup
│   ├── database.py           # SQLAlchemy engine + session
│   ├── models.py             # Session, Chunk, Utterance ORM models
│   ├── schemas.py            # Pydantic request/response shapes
│   ├── requirements.txt
│   ├── .env                  # secrets (not committed)
│   ├── .env.example          # template
│   ├── routes/
│   │   ├── sessions.py
│   │   ├── chunks.py
│   │   └── transcripts.py
│   └── services/
│       └── assemblyai.py     # raw REST calls to AssemblyAI
│
└── frontend/
    ├── app/
    │   ├── page.tsx           # home — session list
    │   ├── record/page.tsx    # recorder UI
    │   └── sessions/[id]/page.tsx  # review UI
    ├── hooks/
    │   └── use-recorder.ts   # mic capture, WAV encoding, OPFS, upload
    └── lib/
        └── api.ts            # typed fetch wrappers
```

---

## Database Schema

Three tables, created automatically:

**sessions** — one row per recording session  
**chunks** — one row per 5-second WAV chunk, with sequence number and ack timestamp  
**utterances** — one row per speaker turn returned by AssemblyAI

---

## Troubleshooting

**Mic not working** — browser requires HTTPS or `localhost`. Make sure you're at `http://localhost:3000`, not a remote URL.

**Chunks stuck on yellow** — server is unreachable. Check that the backend is running on port 8000 and `CORS_ORIGIN` is set correctly.

**Transcription stuck on "transcribing"** — check the backend logs. Most common causes: invalid AssemblyAI API key, or audio file was empty.

**DB tables missing** — just (re)start the backend. `Base.metadata.create_all()` runs on every startup.

**Windows path issues for temp storage** — set `TEMP_DIR` in `.env` to a valid Windows path like `C:/tmp/transcription_pipeline` (forward slashes are fine).
