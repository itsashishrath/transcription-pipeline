from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

from database import engine, Base
from routes import sessions, chunks, transcripts

# Create all tables on startup (fine for hackathon — use Alembic for production)
Base.metadata.create_all(bind=engine)

# Ensure temp dir exists
temp_dir = os.getenv("TEMP_DIR", "/tmp/transcription_pipeline")
os.makedirs(temp_dir, exist_ok=True)

app = FastAPI(title="Transcription Pipeline API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CORS_ORIGIN", "http://localhost:3000")],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(chunks.router)
app.include_router(transcripts.router)


@app.get("/")
def health():
    return {"status": "ok"}
