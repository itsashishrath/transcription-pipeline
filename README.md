# Transcription Pipeline

Record 1–2 hour audio sessions with zero chunk loss, then transcribe with AssemblyAI speaker diarization.

## Stack

- **Frontend** — Next.js 15 + Tailwind CSS
- **Backend** — FastAPI (Python)
- **DB** — PostgreSQL + SQLAlchemy
- **Transcription** — AssemblyAI (batch, speaker diarization)

## How it works

```
Mic → 5s WAV chunk → OPFS (browser) → upload to server → ack to DB
                                                  ↓ (on session end)
                              concatenate all chunks → AssemblyAI
                                                  ↓
                              Speaker A / Speaker B utterances → DB → UI
```

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env
# Fill in DATABASE_URL and ASSEMBLYAI_API_KEY

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Requires PostgreSQL running locally. The API creates tables automatically on startup.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev   # runs on http://localhost:3000
```

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/sessions | Create a new session |
| GET | /api/sessions | List all sessions |
| POST | /api/chunks/upload | Upload a WAV chunk |
| POST | /api/sessions/:id/transcribe | Start AssemblyAI transcription |
| GET | /api/sessions/:id/transcript | Poll transcript status + utterances |
