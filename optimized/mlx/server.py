"""Web server for Stable Audio 3 MLX — FastAPI + SSE."""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
import uuid
from collections import deque
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE = Path(__file__).parent
OUTPUT_DIR = BASE / "output"
UPLOADS_DIR = BASE / "uploads"
WEB_DIR = BASE / "web"
PYTHON = str(BASE / ".venv" / "bin" / "python")
SA3_SCRIPT = str(BASE / "scripts" / "sa3_mlx.py")

OUTPUT_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)

# in-memory job store: job_id -> { status, events queue, result, proc, cancelled }
_jobs: dict[str, dict] = {}
_history: deque = deque(maxlen=20)

# single-job inference queue — prevents concurrent subprocess RAM spikes
_inference_sem = asyncio.Semaphore(1)

app = FastAPI(title="Stable Audio 3")


# ── models ───────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    prompt: str
    mode: str = "text"           # text | restyle | inpaint
    dit: str = "sm-music"
    decoder: str = "same-s"
    seconds: float = Field(30.0, ge=1, le=380)
    steps: int = Field(8, ge=1, le=32)
    cfg: float = Field(1.0, ge=0.1, le=10.0)
    seed: int | None = None
    # restyle / inpaint
    path_token: str | None = None
    init_noise_level: float = Field(0.7, ge=0.01, le=2.0)
    inpaint_start: float | None = None
    inpaint_end: float | None = None
    negative_prompt: str | None = None


# ── background job ────────────────────────────────────────────────────────────



def _strip_ansi(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", text)


def _build_cmd(req: GenerateRequest, job_id: str) -> list[str]:
    cmd = [
        PYTHON, SA3_SCRIPT,
        "--prompt", req.prompt,
        "--dit", req.dit,
        "--decoder", req.decoder,
        "--seconds", str(req.seconds),
        "--steps", str(req.steps),
        "--cfg", str(req.cfg),
        "--out", f"{job_id}.wav",
    ]
    if req.seed is not None:
        cmd += ["--seed", str(req.seed)]
    if req.negative_prompt:
        cmd += ["--negative-prompt", req.negative_prompt]
    if req.mode in ("restyle", "inpaint") and req.path_token:
        upload_path = UPLOADS_DIR / req.path_token
        if not upload_path.exists():
            raise ValueError(f"Upload not found: {req.path_token}")
        cmd += ["--init-audio", str(upload_path)]
        if req.mode == "restyle":
            cmd += ["--init-noise-level", str(req.init_noise_level)]
        elif req.mode == "inpaint" and req.inpaint_start is not None and req.inpaint_end is not None:
            cmd += ["--inpaint-range", f"{req.inpaint_start},{req.inpaint_end}"]
    return cmd


_INLINE_STAGE = re.compile(r"\[(\d+)/5\]\s+(.+?)\s*[·\-]+\s*(\d+)\s+ms")
_STAGE_HEADER = re.compile(r"\[(\d+)/5\]\s+(.+)")
_SAMPLE_LINE  = re.compile(r"\bsample\s+(\d+)\s+ms")
_DECODE_LINE  = re.compile(r"\bdecode\b.*?(\d+)\s+ms")
_DONE_LINE    = re.compile(r"\bdone\s+([\d.]+)s\s+wall.*?([\d.]+)\S*\s*realtime.*?\bseed\s+(\d+)", re.IGNORECASE)


async def _run_job(job_id: str, req: GenerateRequest):
    import os
    job = _jobs[job_id]
    queue: asyncio.Queue = job["queue"]

    try:
        cmd = _build_cmd(req, job_id)
    except ValueError as e:
        await queue.put({"type": "error", "message": str(e)})
        await queue.put(None)
        return

    # signal queued immediately so SSE stream stays alive while waiting
    await queue.put({"type": "queued"})

    async with _inference_sem:
        if job.get("cancelled"):
            await queue.put({"type": "error", "message": "Cancelled"})
            await queue.put(None)
            return

        await queue.put({"type": "running"})

        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(BASE),
            env=env,
        )
        job["proc"] = proc

        current_stage: str | None = None

        assert proc.stdout is not None
        async for raw in proc.stdout:
            if job.get("cancelled"):
                proc.kill()
                break
            line = _strip_ansi(raw.decode("utf-8", errors="replace")).rstrip()
            if not line:
                continue

            m = _INLINE_STAGE.search(line)
            if m:
                name = m.group(2).strip()
                ms = int(m.group(3))
                await queue.put({"type": "progress", "stage": name, "ms": ms})
                current_stage = None
                continue

            m = _STAGE_HEADER.search(line)
            if m:
                current_stage = m.group(2).strip().split("(")[0].split("—")[0].strip()
                continue

            if current_stage and "DiT" in current_stage:
                m = _SAMPLE_LINE.search(line)
                if m:
                    await queue.put({"type": "progress", "stage": current_stage, "ms": int(m.group(1))})
                    current_stage = None
                    continue

            if current_stage and "Decoder" in current_stage:
                m = _DECODE_LINE.search(line)
                if m:
                    await queue.put({"type": "progress", "stage": current_stage, "ms": int(m.group(1))})
                    current_stage = None
                    continue

            m = _DONE_LINE.search(line)
            if m:
                wall = float(m.group(1))
                realtime = float(m.group(2))
                seed = int(m.group(3))
                result = {
                    "type": "done",
                    "file": f"{job_id}.wav",
                    "wall": wall,
                    "realtime": realtime,
                    "seed": seed,
                    "prompt": req.prompt,
                    "seconds": req.seconds,
                }
                job["result"] = result
                _history.appendleft(result)
                await queue.put(result)
                break

        await proc.wait()
        job["proc"] = None

        if job.get("cancelled"):
            await queue.put({"type": "error", "message": "Cancelled"})
        elif proc.returncode != 0 and job.get("result") is None:
            await queue.put({"type": "error", "message": "Generation failed — check server logs."})

    await queue.put(None)  # sentinel


# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(WEB_DIR / "index.html")


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    token = f"{uuid.uuid4()}.wav"
    dest = UPLOADS_DIR / token
    content = await file.read()
    dest.write_bytes(content)
    return {"path_token": token}


@app.post("/generate")
async def generate(req: GenerateRequest):
    job_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _jobs[job_id] = {"queue": queue, "result": None, "request": req, "proc": None, "cancelled": False}
    asyncio.create_task(_run_job(job_id, req))
    return {"job_id": job_id}


@app.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(404, "Job not found")
    job = _jobs[job_id]
    job["cancelled"] = True
    proc = job.get("proc")
    if proc and proc.returncode is None:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
    # if still queued (no proc yet), unblock the SSE stream immediately
    if proc is None and job.get("result") is None:
        try:
            job["queue"].put_nowait({"type": "error", "message": "Cancelled"})
            job["queue"].put_nowait(None)
        except Exception:
            pass
    return {"status": "cancelled"}


@app.get("/events/{job_id}")
async def events(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(404, "Job not found")

    async def stream() -> AsyncGenerator[str, None]:
        queue: asyncio.Queue = _jobs[job_id]["queue"]
        while True:
            event = await queue.get()
            if event is None:
                yield "data: {\"type\":\"end\"}\n\n"
                break
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/audio/{filename}")
async def audio(filename: str):
    # safety: strip any path traversal
    safe = Path(filename).name
    path = OUTPUT_DIR / safe
    if not path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type="audio/wav")


@app.get("/jobs")
async def jobs():
    return list(_history)


app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
