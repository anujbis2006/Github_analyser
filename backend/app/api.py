import os
import uuid
import json
import time
import logging
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator
from dotenv import load_dotenv

from app.github_fetcher import fetch_repo_files
from app.chunker import chunk_files
from app.embedder import embed_and_store, load_existing
from app.rag_chain import build_rag_chain, ask
from app.summarizer import summarize_repo

# Load environment variables
load_dotenv()

# Configure logging
logger = logging.getLogger("uvicorn.error")
logger.setLevel(logging.INFO)

# Initialize FastAPI app
app = FastAPI(
    title="RepoLens API",
    description="AI-powered GitHub repository analyser with RAG chat",
    version="2.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ─── Cache Setup ──────────────────────────────────────────

CACHE_FILE = "./chroma_db/repo_cache.json"

def load_repo_cache() -> dict:
    """Load the repo→persist_dir mapping from disk (survives restarts)."""
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE) as f:
            return json.load(f)
    return {}

def save_repo_cache(cache: dict):
    """Persist the cache to disk after every new embedding."""
    os.makedirs("./chroma_db", exist_ok=True)
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)


sessions: dict = {}
repo_cache: dict = load_repo_cache()   # repo_url -> persist_directory




class AnalyseRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def validate_github_url(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("URL cannot be empty")
        if not v.startswith("http"):
            v = "https://github.com/" + v
        return v


class ChatRequest(BaseModel):
    session_id: str
    question: str
    history: Optional[list[dict]] = []

    @field_validator("question")
    @classmethod
    def validate_question(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Question cannot be empty")
        if len(v) > 2000:
            raise ValueError("Question too long (max 2000 chars)")
        return v




@app.get("/health")
def health():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "sessions_active": len(sessions),
        "repos_cached": len(repo_cache)
    }


@app.get("/api/info")
def root():
    return {
        "message": "RepoLens API is running",
        "version": "2.1.0",
        "docs": "/docs",
        "health": "/health",
        "active_sessions": len(sessions),
        "repos_cached": len(repo_cache)
    }




@app.post("/analyse")
async def analyse(request: AnalyseRequest):
    """
    Streams newline-delimited JSON so the browser connection never times out
    during the long first-run embedding step.

    Each line is either:
      {"status": "progress", "msg": "..."}   ← heartbeat (frontend ignores these)
      {"status": "done", ...full result...}   ← final payload
      {"status": "error", "detail": "..."}   ← error
    """
    import asyncio
    import json as _json
    import traceback

    async def stream():
        try:
            url = request.url.strip().replace(".git", "")
            if not url.startswith("http"):
                url = "https://github.com/" + url
            repo_name = url.rstrip("/").split("/")[-1]

            # ─── Cache Check ──────────────────────────────────
            cached = False
            files = None
            vectorstore = None

            if url in repo_cache:
                persist_dir = repo_cache[url]
                if os.path.exists(persist_dir):
                    yield _json.dumps({"status": "progress", "msg": "Cache hit — loading existing embeddings"}) + "\n"
                    await asyncio.sleep(0)
                    vectorstore = load_existing(persist_dir)
                    cached = True
                    yield _json.dumps({"status": "progress", "msg": "Fetching files for summary..."}) + "\n"
                    await asyncio.sleep(0)
                    files = await fetch_repo_files(url)
                    if not files:
                        yield _json.dumps({"status": "error", "detail": "No readable files found in this repo"}) + "\n"
                        return
                else:
                    del repo_cache[url]
                    save_repo_cache(repo_cache)

            # ─── Full Pipeline (cache miss) ───────────────────
            if not cached:
                yield _json.dumps({"status": "progress", "msg": "Fetching files from GitHub..."}) + "\n"
                await asyncio.sleep(0)
                files = await fetch_repo_files(url)
                if not files:
                    yield _json.dumps({"status": "error", "detail": "No readable files found in this repo"}) + "\n"
                    return

                yield _json.dumps({"status": "progress", "msg": f"Fetched {len(files)} files. Chunking..."}) + "\n"
                await asyncio.sleep(0)
                chunks = chunk_files(files)
                if not chunks:
                    yield _json.dumps({"status": "error", "detail": "Could not create chunks from repo files"}) + "\n"
                    return

                yield _json.dumps({"status": "progress", "msg": f"Embedding {len(chunks)} chunks into ChromaDB (this takes 1-3 min on first run)..."}) + "\n"
                await asyncio.sleep(0)

                persist_dir = f"./chroma_db/{repo_name}"
                loop = asyncio.get_event_loop()
                vectorstore = await loop.run_in_executor(
                    None, lambda: __import__('app.embedder', fromlist=['embed_and_store']).embed_and_store(chunks, persist_directory=persist_dir)
                )
                repo_cache[url] = persist_dir
                save_repo_cache(repo_cache)

            yield _json.dumps({"status": "progress", "msg": "Generating AI summary..."}) + "\n"
            await asyncio.sleep(0)
            result = summarize_repo(files)

            session_id = str(uuid.uuid4())
            chain = build_rag_chain(vectorstore)
            sessions[session_id] = {
                "chain": chain,
                "repo_url": url,
                "repo_slug": repo_name,
                "created_at": datetime.utcnow().isoformat(),
                "message_count": 0,
                "files_fetched": len(files),
                "chunks_created": len(files),
                "from_cache": cached,
            }

            yield _json.dumps({
                "status": "done",
                "session_id": session_id,
                "repo_url": url,
                "files_fetched": len(files),
                "chunks_created": sessions[session_id]["chunks_created"],
                "from_cache": cached,
                "priority_files": result["priority_files"],
                "summary": result["summary"],
                "created_at": sessions[session_id]["created_at"],
            }) + "\n"

        except Exception as e:
            logger.error(f"❌ Analysis failed: {type(e).__name__}: {str(e)}")
            logger.error(traceback.format_exc())
            yield _json.dumps({"status": "error", "detail": f"Analysis failed: {str(e)}"}) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.post("/chat")
def chat(request: ChatRequest):
    session = sessions.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found. Please analyse a repo first.")

    try:
        question = request.question

        if request.history:
            history_text = "\n".join(
                f"{m['role'].upper()}: {m['content']}"
                for m in request.history[-6:]
            )
            question = f"Previous conversation:\n{history_text}\n\nNew question: {question}"

        logger.info(f"💬 Chat request for session {request.session_id}: {question[:100]}...")
        answer = ask(session["chain"], question)
        session["message_count"] += 1
        logger.info("✅ Answer generated")

        return {
            "answer": answer,
            "session_id": request.session_id,
            "message_count": session["message_count"],
        }

    except Exception as e:
        logger.error(f"❌ Chat failed: {type(e).__name__}: {str(e)}")
        err = str(e)
        if "429" in err or "rate_limit" in err:
            raise HTTPException(status_code=429, detail="rate_limit_exceeded")
        raise HTTPException(status_code=500, detail="Something went wrong. Please try again.")


# ─── Cache Management Routes ──────────────────────────────

@app.get("/cache")
def list_cache():
    """See all repos that have cached embeddings."""
    return {
        "cached_repos": len(repo_cache),
        "repos": [
            {"url": url, "persist_dir": path, "exists_on_disk": os.path.exists(path)}
            for url, path in repo_cache.items()
        ]
    }


@app.delete("/cache/{repo_slug}")
def clear_cache_entry(repo_slug: str):
    """Remove a specific repo from the cache by its slug (last part of URL)."""
    to_delete = [url for url in repo_cache if url.rstrip("/").split("/")[-1] == repo_slug]
    if not to_delete:
        raise HTTPException(status_code=404, detail=f"No cached repo matching slug: {repo_slug}")
    for url in to_delete:
        del repo_cache[url]
    save_repo_cache(repo_cache)
    return {"message": f"Cleared cache for: {to_delete}"}


@app.delete("/cache")
def clear_all_cache():
    """Wipe the entire embedding cache (forces re-embedding on next analyse)."""
    count = len(repo_cache)
    repo_cache.clear()
    save_repo_cache(repo_cache)
    return {"message": f"Cleared {count} cached repos"}


# ─── Session Management Routes ────────────────────────────

@app.get("/sessions")
def list_sessions():
    return {
        "active_sessions": len(sessions),
        "sessions": [
            {
                "session_id": sid,
                "repo_url": s["repo_url"],
                "repo_slug": s["repo_slug"],
                "created_at": s["created_at"],
                "message_count": s["message_count"],
                "files_fetched": s["files_fetched"],
                "chunks_created": s["chunks_created"],
                "from_cache": s.get("from_cache", False),
            }
            for sid, s in sessions.items()
        ]
    }


@app.get("/sessions/{session_id}")
def get_session(session_id: str):
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": session_id,
        "repo_url": session["repo_url"],
        "repo_slug": session["repo_slug"],
        "created_at": session["created_at"],
        "message_count": session["message_count"],
        "files_fetched": session["files_fetched"],
        "chunks_created": session["chunks_created"],
        "from_cache": session.get("from_cache", False),
    }


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    repo_slug = sessions[session_id]["repo_slug"]
    del sessions[session_id]
    logger.info(f"🗑️ Deleted session for: {repo_slug}")
    return {"message": f"Session for '{repo_slug}' deleted"}


@app.delete("/sessions")
def clear_all_sessions():
    count = len(sessions)
    sessions.clear()
    logger.info(f"🗑️ Cleared {count} sessions")
    return {"message": f"Cleared {count} sessions"}


# ─── Error Handlers ───────────────────────────────────────

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    logger.warning(f"HTTP {exc.status_code}: {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {type(exc).__name__}: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )



if os.path.exists("index.html"):
    app.mount("/", StaticFiles(directory=".", html=True), name="static")