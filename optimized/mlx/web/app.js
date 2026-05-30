/* Stable Audio 3 — UI logic */

const $ = (id) => document.getElementById(id);

// ── state ─────────────────────────────────────────────────────────────────────
let currentMode = "text";
let pathToken = null;
let wavesurfer = null;
let currentJobId = null;

// variations state
let varPathToken = null;
let varSourceDuration = null;
let varSourceWavesurfer = null;
let varKnobValue = 40;
const varWavesurfers = []; // one per variation card
let varActiveJobIds = [];  // for cancel
let varActiveStreams = []; // EventSource refs for cancel

// ── prompt harness ────────────────────────────────────────────────────────────

// Maps instrument keywords → reinforcing phrases added to the positive prompt.
const INSTRUMENT_POS = {
  piano:     ["solo piano", "piano only", "piano melody"],
  keys:      ["keys only", "keyboard melody"],
  keyboard:  ["keys only", "keyboard melody"],
  guitar:    ["guitar only", "guitar melody"],
  strings:   ["strings only", "orchestral strings"],
  violin:    ["solo violin", "violin melody"],
  cello:     ["solo cello", "cello melody"],
  viola:     ["solo viola"],
  synth:     ["synth only", "synthesizer lead"],
  pad:       ["atmospheric pad", "ambient texture"],
  flute:     ["solo flute", "flute melody"],
  oboe:      ["solo oboe"],
  trumpet:   ["solo trumpet"],
  saxophone: ["solo saxophone"],
  sax:       ["solo saxophone"],
  choir:     ["choral", "choir voices"],
  vocals:    ["vocals only", "a cappella"],
  voice:     ["vocals only", "a cappella"],
  drums:     ["drum loop", "percussion only"],
  percussion:["percussion loop", "drums only"],
};

// Returns reinforcement phrases for any instrument keywords found in `style`.
function derivePosPhrases(style) {
  const lower = style.toLowerCase();
  const phrases = [];
  for (const [keyword, terms] of Object.entries(INSTRUMENT_POS)) {
    if (lower.includes(keyword)) phrases.push(...terms);
  }
  return phrases;
}

// Maps instrument keywords → terms to suppress in the negative prompt.
// Melodic instruments exclude percussive bleed; drums exclude melodic bleed.
const INSTRUMENT_NEG = {
  piano:     ["drums", "drum kit", "percussion", "beats", "kick", "snare", "hi-hat"],
  keys:      ["drums", "drum kit", "percussion", "beats"],
  keyboard:  ["drums", "drum kit", "percussion", "beats"],
  guitar:    ["drums", "drum kit", "percussion", "beats"],
  strings:   ["drums", "percussion", "electric guitar"],
  violin:    ["drums", "percussion"],
  cello:     ["drums", "percussion"],
  viola:     ["drums", "percussion"],
  synth:     ["drums", "percussion", "beats"],
  pad:       ["drums", "percussion", "beats", "rhythm"],
  flute:     ["drums", "percussion"],
  oboe:      ["drums", "percussion"],
  trumpet:   ["drums", "percussion"],
  saxophone: ["drums", "percussion"],
  sax:       ["drums", "percussion"],
  choir:     ["drums", "percussion"],
  vocals:    ["drums", "percussion"],
  voice:     ["drums", "percussion"],
  drums:     ["melody", "lead", "vocals"],
  percussion:["melody", "lead", "vocals"],
};

// Returns a negative prompt string derived from instrument keywords in `style`,
// or null if nothing matched. Respects explicit user overrides by returning null
// when the user has already typed a negative prompt.
function deriveNegPrompt(style) {
  const lower = style.toLowerCase();
  const exclusions = new Set();
  for (const [keyword, terms] of Object.entries(INSTRUMENT_NEG)) {
    if (lower.includes(keyword)) terms.forEach((t) => exclusions.add(t));
  }
  return exclusions.size ? [...exclusions].join(", ") : null;
}

// ── init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  bindToolNav();
  bindModeTabs();
  bindRangeInputs();
  bindFileUpload();
  bindGenerate();
  bindCfgVisibility();
  loadHistory();
  bindVariationsUpload();
  bindKnob();
  bindCreateVariations();
  bindCancelVariations();
});

// ── mode tabs ─────────────────────────────────────────────────────────────────
function bindModeTabs() {
  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".mode-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentMode = tab.dataset.mode;
      updateModeUI();
    });
  });
}

function updateModeUI() {
  const audioControls = $("audio-controls");
  const restyleControls = $("restyle-controls");
  const inpaintRange = $("inpaint-range");
  const title = $("audio-controls-title");

  if (currentMode === "text") {
    audioControls.classList.remove("visible");
  } else {
    audioControls.classList.add("visible");
    if (currentMode === "restyle") {
      title.textContent = "Source audio";
      restyleControls.style.display = "block";
      inpaintRange.classList.remove("visible");
    } else {
      title.textContent = "Source audio";
      restyleControls.style.display = "none";
      inpaintRange.classList.add("visible");
    }
  }
}

// ── range inputs ──────────────────────────────────────────────────────────────
function bindRangeInputs() {
  const pairs = [
    ["duration", "duration-val", (v) => `${v}s`],
    ["steps", "steps-val", (v) => v],
    ["cfg", "cfg-val", (v) => parseFloat(v).toFixed(1)],
    ["noise-level", "noise-level-val", (v) => parseFloat(v).toFixed(2)],
  ];
  pairs.forEach(([inputId, labelId, fmt]) => {
    const input = $(inputId);
    const label = $(labelId);
    if (!input || !label) return;
    label.textContent = fmt(input.value);
    input.addEventListener("input", () => {
      label.textContent = fmt(input.value);
    });
  });
}

function bindCfgVisibility() {
  const cfgInput = $("cfg");
  const negRow = $("neg-prompt-row");
  cfgInput.addEventListener("input", () => {
    negRow.style.display = parseFloat(cfgInput.value) > 1.0 ? "block" : "none";
  });
}

// ── file upload ───────────────────────────────────────────────────────────────
function bindFileUpload() {
  const fileInput = $("audio-file");
  const zone = $("upload-zone");
  const label = $("upload-filename");

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    label.textContent = file.name;
    zone.classList.add("has-file");
    pathToken = await uploadFile(file);
  });

  // drag-and-drop
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.style.borderColor = "var(--primary)"; });
  zone.addEventListener("dragleave", () => { zone.style.borderColor = ""; });
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.style.borderColor = "";
    const file = e.dataTransfer.files[0];
    if (!file) return;
    label.textContent = file.name;
    zone.classList.add("has-file");
    pathToken = await uploadFile(file);
  });
}

async function uploadFile(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/upload", { method: "POST", body: form });
  const data = await res.json();
  return data.path_token;
}

// ── generate ──────────────────────────────────────────────────────────────────
function bindGenerate() {
  $("btn-generate").addEventListener("click", startGeneration);
}

async function startGeneration() {
  const prompt = $("prompt").value.trim();
  if (!prompt) {
    $("prompt").focus();
    return;
  }
  if (currentMode !== "text" && !pathToken) {
    $("upload-zone").style.borderColor = "var(--destructive)";
    setTimeout(() => ($("upload-zone").style.borderColor = ""), 1500);
    return;
  }

  const [dit, decoder] = $("model-select").value.split("|");
  const seedVal = $("seed").value.trim();

  const body = {
    prompt,
    mode: currentMode,
    dit,
    decoder,
    seconds: parseFloat($("duration").value),
    steps: parseInt($("steps").value),
    cfg: parseFloat($("cfg").value),
    seed: seedVal ? parseInt(seedVal) : null,
    negative_prompt: $("negative-prompt").value.trim() || null,
    path_token: pathToken,
    init_noise_level: parseFloat($("noise-level").value),
    inpaint_start: currentMode === "inpaint" ? parseFloat($("inpaint-start").value) : null,
    inpaint_end: currentMode === "inpaint" ? parseFloat($("inpaint-end").value) : null,
  };

  setGenerating(true);
  resetProgress();
  hideResult();

  const res = await fetch("/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const { job_id } = await res.json();
  currentJobId = job_id;
  listenToEvents(job_id, body);
}

// ── SSE ───────────────────────────────────────────────────────────────────────
const STAGE_ORDER = [
  "T5Gemma encode",
  "Conditioning",
  "DiT",
  "Decoder",
  "Unpatch + write WAV",
];
// rough max ms per stage for bar scaling
const STAGE_MAX = {
  "T5Gemma encode": 2500,
  "Conditioning": 500,
  "DiT": 5000,
  "Decoder": 1500,
  "Unpatch + write WAV": 200,
};
const DEFAULT_MAX = 3000;

function listenToEvents(jobId, reqBody) {
  const es = new EventSource(`/events/${jobId}`);
  es.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === "progress") {
      addStageRow(event.stage, event.ms);
    } else if (event.type === "done") {
      es.close();
      setGenerating(false);
      showResult(event, reqBody);
      addToLocalHistory(event);
    } else if (event.type === "error") {
      es.close();
      setGenerating(false);
      showError(event.message);
    } else if (event.type === "end") {
      es.close();
      setGenerating(false);
    }
  };
  es.onerror = () => {
    es.close();
    setGenerating(false);
  };
}

function resetProgress() {
  const list = $("stage-list");
  list.innerHTML = "";
  $("progress-section").classList.add("visible");
}

function addStageRow(stageName, ms) {
  const list = $("stage-list");
  const max = STAGE_MAX[stageName] ?? DEFAULT_MAX;
  const pct = Math.min(100, (ms / max) * 100);

  const row = document.createElement("div");
  row.className = "stage-row";
  row.innerHTML = `
    <span class="stage-name">${escapeHtml(stageName)}</span>
    <div class="stage-bar-bg">
      <div class="stage-bar-fill" style="width:0%"></div>
    </div>
    <span class="stage-ms">${ms > 999 ? (ms / 1000).toFixed(1) + "s" : ms + "ms"}</span>
  `;
  list.appendChild(row);

  // animate in then fill bar
  requestAnimationFrame(() => {
    row.classList.add("visible");
    setTimeout(() => {
      row.querySelector(".stage-bar-fill").style.width = `${pct}%`;
    }, 50);
  });
}

// ── result ────────────────────────────────────────────────────────────────────
function hideResult() {
  $("result-section").classList.remove("visible");
  if (wavesurfer) { wavesurfer.destroy(); wavesurfer = null; }
}

function showResult(event, reqBody) {
  const section = $("result-section");
  section.classList.add("visible");

  $("result-prompt").textContent = reqBody.prompt;
  $("result-stats").textContent =
    `${event.seconds ?? reqBody.seconds}s · ${event.realtime?.toFixed(1)}× realtime · seed ${event.seed} · ${event.wall?.toFixed(1)}s wall`;

  const audioUrl = `/audio/${event.file}`;
  $("btn-download").href = audioUrl;
  $("btn-download").setAttribute("download", event.file);

  initWavesurfer(audioUrl, event.seconds ?? reqBody.seconds);
}

function initWavesurfer(url, durationHint) {
  if (wavesurfer) { wavesurfer.destroy(); wavesurfer = null; }

  wavesurfer = WaveSurfer.create({
    container: "#waveform",
    waveColor: "#3d3d42",
    progressColor: "#51d4d4",
    cursorColor: "#51d4d4",
    cursorWidth: 2,
    height: 64,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
    backend: "WebAudio",
  });

  wavesurfer.load(url);

  wavesurfer.on("ready", () => updatePlayerTime(wavesurfer));
  wavesurfer.on("audioprocess", () => updatePlayerTime(wavesurfer));
  wavesurfer.on("finish", () => { $("btn-play").textContent = "▶"; });

  $("btn-play").onclick = () => {
    wavesurfer.playPause();
    $("btn-play").textContent = wavesurfer.isPlaying() ? "⏸" : "▶";
  };
}

function updatePlayerTime(ws) {
  const cur = ws.getCurrentTime();
  const dur = ws.getDuration();
  $("player-time").textContent = `${fmt(cur)} / ${fmt(dur)}`;
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ── history ───────────────────────────────────────────────────────────────────
async function loadHistory() {
  const res = await fetch("/jobs").catch(() => null);
  if (!res?.ok) return;
  const jobs = await res.json();
  jobs.forEach(renderHistoryCard);
  if (jobs.length) $("history-section").classList.add("visible");
}

function addToLocalHistory(event) {
  const section = $("history-section");
  const list = $("history-list");

  // prepend
  const card = buildHistoryCard(event);
  list.insertBefore(card, list.firstChild);
  section.classList.add("visible");

  // cap at 20
  while (list.children.length > 20) list.removeChild(list.lastChild);
}

function renderHistoryCard(job) {
  $("history-list").appendChild(buildHistoryCard(job));
  $("history-section").classList.add("visible");
}

function buildHistoryCard(job) {
  const card = document.createElement("div");
  card.className = "history-card";

  const audioUrl = `/audio/${job.file}`;
  card.innerHTML = `
    <div class="history-card-prompt">${escapeHtml(job.prompt ?? "")}</div>
    <div class="history-card-meta">${job.seconds ?? "?"}s</div>
    <div class="history-card-actions">
      <button class="btn-icon" title="Load into player">▶</button>
      <a class="btn-icon" href="${audioUrl}" download="${job.file}" title="Download">⬇</a>
    </div>
  `;

  card.querySelector(".btn-icon").addEventListener("click", () => {
    showResult(job, { prompt: job.prompt, seconds: job.seconds });
    $("result-section").scrollIntoView({ behavior: "smooth" });
  });

  return card;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function setGenerating(on) {
  const btn = $("btn-generate");
  btn.disabled = on;
  btn.classList.toggle("loading", on);
  if (!on) $("progress-section").classList.remove("visible");
}

function showError(msg) {
  const list = $("stage-list");
  const row = document.createElement("div");
  row.style.cssText = "color: var(--destructive); font-size: 13px; padding: 4px 0;";
  row.textContent = `Error: ${msg}`;
  list.appendChild(row);
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── tool nav ──────────────────────────────────────────────────────────────────
function bindToolNav() {
  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tool = btn.dataset.tool;
      $("tool-generate").style.display = tool === "generate" ? "" : "none";
      $("tool-variations").style.display = tool === "variations" ? "" : "none";
    });
  });
}

// ── variations upload ─────────────────────────────────────────────────────────
function bindVariationsUpload() {
  const zone = $("var-upload-zone");
  const fileInput = $("var-audio-file");

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleVarFile(fileInput.files[0]);
  });

  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.style.borderColor = "var(--primary)"; });
  zone.addEventListener("dragleave", () => { zone.style.borderColor = ""; });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.style.borderColor = "";
    if (e.dataTransfer.files[0]) handleVarFile(e.dataTransfer.files[0]);
  });
}

async function handleVarFile(file) {
  const zone = $("var-upload-zone");
  const idle = $("var-upload-idle");
  const ready = $("var-upload-ready");

  // parse filename for BPM and key hints
  parseFilenameHints(file.name);

  // read duration client-side
  try {
    const arrayBuf = await file.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioCtx.decodeAudioData(arrayBuf);
    varSourceDuration = decoded.duration;
    audioCtx.close();
  } catch {
    varSourceDuration = null;
  }

  // upload to server
  varPathToken = await uploadFile(file);

  // update UI
  zone.classList.add("has-file");
  idle.style.display = "none";
  ready.style.display = "block";
  $("var-source-name").textContent = file.name;

  // render source waveform
  if (varSourceWavesurfer) { varSourceWavesurfer.destroy(); varSourceWavesurfer = null; }
  varSourceWavesurfer = WaveSurfer.create({
    container: "#var-source-waveform",
    waveColor: "#3d3d42",
    progressColor: "#51d4d4",
    cursorColor: "#51d4d4",
    cursorWidth: 2,
    height: 48,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
  });
  varSourceWavesurfer.load(URL.createObjectURL(file));
  varSourceWavesurfer.on("ready", () => {
    const dur = varSourceWavesurfer.getDuration();
    $("var-source-time").textContent = `0:00 / ${fmt(dur)}`;
  });
  varSourceWavesurfer.on("audioprocess", () => {
    $("var-source-time").textContent =
      `${fmt(varSourceWavesurfer.getCurrentTime())} / ${fmt(varSourceWavesurfer.getDuration())}`;
  });
  varSourceWavesurfer.on("finish", () => { $("var-source-play").textContent = "▶"; });
  $("var-source-play").onclick = () => {
    varSourceWavesurfer.playPause();
    $("var-source-play").textContent = varSourceWavesurfer.isPlaying() ? "⏸" : "▶";
  };

  // enable button
  const btn = $("btn-create-variations");
  btn.disabled = false;
  btn.querySelector(".btn-label").textContent = "Create variations";
}

// best-effort filename hints
function parseFilenameHints(filename) {
  const name = filename.replace(/\.[^.]+$/, ""); // strip extension

  // BPM: matches "120bpm", "120_bpm", "_120_"
  const bpmMatch = name.match(/\b(\d{2,3})\s*bpm\b/i) || name.match(/_(\d{2,3})_/);
  if (bpmMatch) {
    const bpm = parseInt(bpmMatch[1]);
    if (bpm >= 40 && bpm <= 300) $("var-bpm").value = bpm;
  }

  // Key: common sample pack conventions
  const KEY_MAP = {
    "Cmaj": "C major", "Cmin": "C minor", "C#maj": "C# major", "C#min": "C# minor",
    "Dmaj": "D major", "Dmin": "D minor", "D#maj": "D# major", "D#min": "D# minor",
    "Emaj": "E major", "Emin": "E minor",
    "Fmaj": "F major", "Fmin": "F minor", "F#maj": "F# major", "F#min": "F# minor",
    "Gmaj": "G major", "Gmin": "G minor", "G#maj": "G# major", "G#min": "G# minor",
    "Amaj": "A major", "Amin": "A minor", "A#maj": "A# major", "A#min": "A# minor",
    "Bmaj": "B major", "Bmin": "B minor",
  };
  for (const [pat, key] of Object.entries(KEY_MAP)) {
    if (name.includes(pat)) {
      $("var-key").value = key;
      break;
    }
  }
}

// ── rotary knob ───────────────────────────────────────────────────────────────
function bindKnob() {
  const body = document.querySelector("#knob-complexity .knob-body");
  const label = $("knob-value");
  let dragging = false;
  let startY = 0;
  let startVal = varKnobValue;

  function setKnobValue(v) {
    varKnobValue = Math.max(0, Math.min(100, v));
    const angle = (varKnobValue / 100) * 270 - 135;
    body.style.transform = `rotate(${angle}deg)`;
    label.textContent = Math.round(varKnobValue);
  }

  // init position
  setKnobValue(varKnobValue);

  body.addEventListener("mousedown", (e) => {
    dragging = true;
    startY = e.clientY;
    startVal = varKnobValue;
    body.classList.add("dragging");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const delta = startY - e.clientY; // drag up = increase
    setKnobValue(startVal + delta * 0.6);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    body.classList.remove("dragging");
  });

  // double-click to reset
  body.addEventListener("dblclick", () => setKnobValue(40));
}

// ── create variations ─────────────────────────────────────────────────────────
function bindCreateVariations() {
  $("btn-create-variations").addEventListener("click", startVariations);
}

function buildVariationPrompt() {
  const style = $("var-style").value.trim();
  const bpm = $("var-bpm").value.trim();
  const key = $("var-key").value;
  const reinforcements = derivePosPhrases(style);
  const parts = [style || "music sample", ...reinforcements];
  if (bpm) parts.push(`${bpm} BPM`);
  if (key !== "none") parts.push(`in ${key}`);
  return parts.join(", ");
}

async function startVariations() {
  if (!varPathToken) return;

  const btn = $("btn-create-variations");
  btn.disabled = true;
  btn.classList.add("loading");

  // destroy previous wavesurfers
  varWavesurfers.forEach((ws) => ws && ws.destroy());
  varWavesurfers.length = 0;

  const [dit, decoder] = $("model-select").value.split("|");
  const t = varKnobValue / 100;
  const noiseLevel = 0.15 + t * 0.65;          // 0.15 → 0.80
  const steps = Math.round(4 + t * 16);         // 4 → 20
  const cfg = 1.0 + t * 2.5;                    // 1.0 → 3.5
  const prompt = buildVariationPrompt();
  const style = $("var-style").value.trim();
  const negPrompt = deriveNegPrompt(style);
  const seconds = varSourceDuration ? Math.max(1, Math.round(varSourceDuration * 10) / 10) : 30;

  // build 4 variation cards (loading state)
  const list = $("variation-list");
  list.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    list.appendChild(buildVariationCardLoading(i + 1));
    varWavesurfers.push(null);
  }

  // fire 4 generate requests (server queues them serially via semaphore)
  const seeds = Array.from({ length: 4 }, () => Math.floor(Math.random() * 2 ** 31));
  const jobs = await Promise.all(seeds.map((seed) =>
    fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        mode: "restyle",
        dit,
        decoder,
        seconds,
        steps,
        cfg,
        seed,
        negative_prompt: negPrompt,
        path_token: varPathToken,
        init_noise_level: noiseLevel,
      }),
    }).then((r) => r.json())
  ));

  varActiveJobIds = jobs.map((j) => j.job_id);
  varActiveStreams = [];

  // show cancel button
  $("btn-cancel-variations").style.display = "";

  // open SSE streams for all 4 (server runs them serially)
  let doneCount = 0;
  jobs.forEach(({ job_id }, idx) => {
    const es = listenToVariationEvents(job_id, idx, () => {
      doneCount++;
      if (doneCount === jobs.length) {
        finishVariations();
      }
    });
    varActiveStreams.push(es);
  });
}

function buildVariationCardLoading(n) {
  const card = document.createElement("div");
  card.className = "variation-card";
  card.id = `var-card-${n}`;
  card.innerHTML = `
    <div class="variation-card-header">
      <span class="variation-number">Variation ${n}</span>
      <div class="variation-loading">
        <div class="spinner"></div>
        <span class="variation-stage" id="var-stage-${n}">Preparing…</span>
      </div>
    </div>
  `;
  return card;
}

function listenToVariationEvents(jobId, idx, onDone) {
  const n = idx + 1;
  const es = new EventSource(`/events/${jobId}`);

  es.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === "queued") {
      const stageEl = $(`var-stage-${n}`);
      if (stageEl) stageEl.textContent = "Queued…";
    } else if (event.type === "running") {
      const stageEl = $(`var-stage-${n}`);
      if (stageEl) stageEl.textContent = "Starting…";
    } else if (event.type === "progress") {
      const stageEl = $(`var-stage-${n}`);
      if (stageEl) stageEl.textContent = event.stage + "…";
    } else if (event.type === "done") {
      es.close();
      renderVariationCard(idx, event);
      onDone();
    } else if (event.type === "error") {
      es.close();
      const stageEl = $(`var-stage-${n}`);
      if (stageEl) {
        stageEl.textContent = event.message === "Cancelled" ? "Cancelled" : "Failed";
        stageEl.style.color = "var(--muted)";
      }
      onDone();
    } else if (event.type === "end") {
      es.close();
      onDone();
    }
  };
  es.onerror = () => { es.close(); onDone(); };
  return es;
}

function finishVariations() {
  const btn = $("btn-create-variations");
  btn.disabled = false;
  btn.classList.remove("loading");
  btn.querySelector(".btn-label").textContent = "Create variations";
  $("btn-cancel-variations").style.display = "none";
  varActiveJobIds = [];
  varActiveStreams = [];
}

function bindCancelVariations() {
  $("btn-cancel-variations").addEventListener("click", async () => {
    // close SSE streams
    varActiveStreams.forEach((es) => es.close());
    // cancel jobs on server
    await Promise.allSettled(
      varActiveJobIds.map((id) => fetch(`/jobs/${id}`, { method: "DELETE" }))
    );
    finishVariations();
  });
}

function renderVariationCard(idx, event) {
  const n = idx + 1;
  const card = $(`var-card-${n}`);
  if (!card) return;

  const audioUrl = `/audio/${event.file}`;
  card.innerHTML = `
    <div class="variation-card-header">
      <span class="variation-number">Variation ${n}</span>
      <span class="variation-meta">${event.seconds ?? "?"}s · seed ${event.seed}</span>
      <div class="variation-actions">
        <a class="btn-icon" href="${audioUrl}" download="${event.file}" title="Download">⬇</a>
      </div>
    </div>
    <div class="variation-waveform" id="var-waveform-${n}"></div>
    <div class="variation-player">
      <button class="btn-play" id="var-play-${n}" title="Play / Pause" style="width:28px;height:28px;font-size:11px">▶</button>
      <span class="player-time" id="var-time-${n}">0:00 / 0:00</span>
    </div>
  `;

  // init wavesurfer for this card
  const ws = WaveSurfer.create({
    container: `#var-waveform-${n}`,
    waveColor: "#3d3d42",
    progressColor: "#51d4d4",
    cursorColor: "#51d4d4",
    cursorWidth: 2,
    height: 48,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    normalize: true,
  });
  ws.load(audioUrl);
  ws.on("ready", () => updateVarTime(ws, n));
  ws.on("audioprocess", () => updateVarTime(ws, n));
  ws.on("finish", () => { $(`var-play-${n}`).textContent = "▶"; });
  varWavesurfers[idx] = ws;

  $(`var-play-${n}`).onclick = () => {
    ws.playPause();
    $(`var-play-${n}`).textContent = ws.isPlaying() ? "⏸" : "▶";
  };
}

function updateVarTime(ws, n) {
  const el = $(`var-time-${n}`);
  if (el) el.textContent = `${fmt(ws.getCurrentTime())} / ${fmt(ws.getDuration())}`;
}
