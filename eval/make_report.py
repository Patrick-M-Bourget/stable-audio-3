"""
Generate a clean, shareable HTML report from the latest eval run.

Usage:
    cd /path/to/STABLE-AUDIO3
    uv run python eval/make_report.py

Output:
    eval/results/<latest_run>/report.html

Sharing:
    zip -r eval_report.zip eval/results/<latest_run>/
    Upload the zip to Google Drive / Slack / Dropbox.
    Recipient unzips and opens report.html in any browser.
"""

import yaml
from pathlib import Path

RESULTS_DIR = Path(__file__).parent / "results"
CONFIG_PATH = Path(__file__).parent / "config.yaml"

PROMPT_LABELS = {
    "technical_lofi":           "Lo-fi hip hop beat, vinyl crackle, mellow piano, 90 BPM",
    "technical_ambient_guitar": "Ambient guitar loop, hall reverb, dreamy, 100 BPM, D major",
    "technical_drum_loop":      "Electronic drum loop, punchy kick, experimental, 136 BPM",
    "technical_synth_bass":     "Synth bass loop, Juno-style, warm, minor key, 125 BPM",
    "technical_cello":          "Cello ensemble, cinematic, emotional, slow and lush strings",
    "cello_ensemble":           "Cello ensemble, cinematic, emotional, slow and lush strings",
    "human_study_music":        "something chill to study to late at night",
    "human_sad_rainy_day":      "music that sounds like a sad rainy day looking out the window",
    "human_hype_workout":       "something really hype and energetic for working out",
    "human_summer_vibes":       "a beat that feels like summer at the beach with friends",
    "human_scary_game":         "creepy background music for a horror video game",
    "human_coffee_shop":        "the kind of music playing in a cool coffee shop on a Sunday morning",
    "human_epic_moment":        "music for an epic movie scene where the hero wins",
}

CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       background: #f4f4f6; color: #1a1a2e; }
header { background: #1a1a2e; color: #fff; padding: 32px 40px; }
header h1 { font-size: 26px; font-weight: 700; }
header p  { margin-top: 6px; opacity: .7; font-size: 14px; }
nav { background: #fff; border-bottom: 1px solid #ddd;
      padding: 12px 40px; display: flex; gap: 24px; position: sticky; top:0; z-index:10; }
nav a { color: #1a1a2e; text-decoration: none; font-size: 14px; font-weight: 600;
        opacity: .6; }
nav a:hover { opacity: 1; }
main { max-width: 1200px; margin: 0 auto; padding: 32px 40px; }
section { margin-bottom: 48px; }
h2 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
.section-desc { font-size: 14px; color: #555; margin-bottom: 20px; line-height: 1.5; }
details { background: #fff; border: 1px solid #e0e0e8; border-radius: 10px;
          margin-bottom: 16px; overflow: hidden; }
details[open] summary { border-bottom: 1px solid #e0e0e8; }
summary { padding: 16px 20px; cursor: pointer; font-weight: 600; font-size: 15px;
          list-style: none; display: flex; align-items: center; gap: 10px; }
summary::-webkit-details-marker { display: none; }
summary::before { content: '▶'; font-size: 11px; color: #888; transition: transform .2s; }
details[open] summary::before { transform: rotate(90deg); }
.card-body { padding: 20px; }
.prompt-text { font-size: 13px; color: #555; font-style: italic;
               margin-bottom: 16px; padding: 10px 14px;
               background: #f8f8fc; border-left: 3px solid #6c63ff; border-radius: 4px; }
.step-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.audio-block { display: flex; flex-direction: column; gap: 6px; }
.audio-label { font-size: 12px; font-weight: 600; color: #444; text-transform: uppercase;
               letter-spacing: .04em; }
audio { width: 100%; height: 36px; }
.variation-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.variation-group h4 { font-size: 13px; font-weight: 700; color: #6c63ff;
                       margin-bottom: 12px; text-transform: uppercase; letter-spacing: .04em; }
.noise-row { margin-bottom: 10px; }
.noise-label { font-size: 11px; color: #888; margin-bottom: 4px; }
.extend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 700px) {
  .variation-groups, .extend-grid { grid-template-columns: 1fr; }
  main { padding: 20px; }
  header { padding: 20px; }
}
"""

def audio_tag(rel_path):
    return f'<audio controls preload="none"><source src="{rel_path}" type="audio/wav"></audio>'

def label_from_stem(stem):
    return stem.replace("_", " ").replace("-", " ").title()

def build_section1(gen_dir, run_dir):
    if not gen_dir.exists():
        return ""

    wavs = sorted(gen_dir.glob("*.wav"))
    prompts = {}
    for w in wavs:
        parts = w.stem.rsplit("_steps", 1)
        if len(parts) == 2:
            key, steps = parts[0], int(parts[1])
            prompts.setdefault(key, {})[steps] = w

    technical = {k: v for k, v in prompts.items() if k.startswith("technical_") or k == "cello_ensemble"}
    human     = {k: v for k, v in prompts.items() if k.startswith("human_")}

    def render_group(group, title):
        html = f"<h3 style='font-size:16px;margin:24px 0 12px'>{title}</h3>"
        for key, steps_map in sorted(group.items()):
            prompt_text = PROMPT_LABELS.get(key, label_from_stem(key))
            display_name = label_from_stem(key.replace("technical_", "").replace("human_", ""))
            html += f"""
<details open>
  <summary>{display_name}</summary>
  <div class="card-body">
    <div class="prompt-text">"{prompt_text}"</div>
    <div class="step-grid">
"""
            for steps in sorted(steps_map):
                rel = steps_map[steps].relative_to(run_dir)
                html += f"""
      <div class="audio-block">
        <span class="audio-label">Steps = {steps}</span>
        {audio_tag(rel)}
      </div>"""
            html += "\n    </div>\n  </div>\n</details>"
        return html

    out = render_group(technical, "Technical prompts — producer-style (BPM, key, instrument)")
    out += render_group(human, "Human prompts — natural language")
    return out

def build_section2(var_dir, run_dir, prompt_pool):
    if not var_dir.exists():
        return ""

    html = ""
    for i, sample_dir in enumerate(sorted(var_dir.iterdir())):
        if not sample_dir.is_dir():
            continue

        creative_prompt = prompt_pool[i % len(prompt_pool)]
        orig     = sample_dir / "original.wav"
        n_03     = sample_dir / "neutral_noise_0.3.wav"
        n_06     = sample_dir / "neutral_noise_0.6.wav"
        n_09     = sample_dir / "neutral_noise_0.9.wav"
        c_03     = sample_dir / "creative_noise_0.3.wav"
        c_06     = sample_dir / "creative_noise_0.6.wav"
        c_09     = sample_dir / "creative_noise_0.9.wav"

        name = sample_dir.name.replace("_", " ").replace("-", " ")
        html += f"""
<details>
  <summary>{name}</summary>
  <div class="card-body">
    <div class="step-grid" style="margin-bottom:20px">
      <div class="audio-block">
        <span class="audio-label">Original</span>
        {audio_tag(orig.relative_to(run_dir))}
      </div>
    </div>
    <div class="variation-groups">
      <div>
        <h4>Neutral prompt — <em style="font-weight:400">"audio"</em></h4>
        <div class="noise-row">
          <div class="noise-label">Noise 0.3 — subtle</div>
          {audio_tag(n_03.relative_to(run_dir)) if n_03.exists() else '—'}
        </div>
        <div class="noise-row">
          <div class="noise-label">Noise 0.6 — moderate</div>
          {audio_tag(n_06.relative_to(run_dir)) if n_06.exists() else '—'}
        </div>
        <div class="noise-row">
          <div class="noise-label">Noise 0.9 — heavy</div>
          {audio_tag(n_09.relative_to(run_dir)) if n_09.exists() else '—'}
        </div>
      </div>
      <div>
        <h4>Creative prompt — <em style="font-weight:400;color:#444">"{creative_prompt}"</em></h4>
        <div class="noise-row">
          <div class="noise-label">Noise 0.3 — subtle</div>
          {audio_tag(c_03.relative_to(run_dir)) if c_03.exists() else '—'}
        </div>
        <div class="noise-row">
          <div class="noise-label">Noise 0.6 — moderate</div>
          {audio_tag(c_06.relative_to(run_dir)) if c_06.exists() else '—'}
        </div>
        <div class="noise-row">
          <div class="noise-label">Noise 0.9 — heavy</div>
          {audio_tag(c_09.relative_to(run_dir)) if c_09.exists() else '—'}
        </div>
      </div>
    </div>
  </div>
</details>"""
    return html

def build_section3(ext_dir, run_dir):
    if not ext_dir.exists():
        return ""

    # discover grid values from filenames  e.g. dur2.0x_steps8_cfg1.0.wav
    html = ""
    for sample_dir in sorted(ext_dir.iterdir()):
        if not sample_dir.is_dir():
            continue

        orig = sample_dir / "original.wav"
        name = sample_dir.name.replace("_", " ").replace("-", " ")

        # collect all generated files — filename: add5s_steps30_cfg1.0.wav
        grid = {}  # (add_sec, steps, cfg) -> Path
        adds, steps_set, cfgs_set = set(), set(), set()
        for wav in sample_dir.glob("add*s_steps*_cfg*.wav"):
            parts = wav.stem.split("_")
            try:
                add_sec = int(parts[0].replace("add", "").replace("s", ""))
                steps   = int(parts[1].replace("steps", ""))
                cfg     = float(parts[2].replace("cfg", ""))
                grid[(add_sec, steps, cfg)] = wav
                adds.add(add_sec); steps_set.add(steps); cfgs_set.add(cfg)
            except (ValueError, IndexError):
                continue

        adds_list  = sorted(adds)
        steps_list = sorted(steps_set)
        cfgs_list  = sorted(cfgs_set)

        if not grid:
            continue

        html += f"""
<details>
  <summary>{name}</summary>
  <div class="card-body">
    <div class="audio-block" style="margin-bottom:16px">
      <span class="audio-label">Original</span>
      {audio_tag(orig.relative_to(run_dir)) if orig.exists() else '—'}
    </div>"""

        for add_sec in adds_list:
            html += f'<h4 style="margin:16px 0 10px;font-size:13px;color:#6c63ff">+{add_sec}s extension</h4>'
            html += '<table style="border-collapse:collapse;width:100%"><thead><tr><th></th>'
            for cfg in cfgs_list:
                html += f'<th style="padding:6px 12px;font-size:12px;color:#555;font-weight:600">CFG {cfg}</th>'
            html += '</tr></thead><tbody>'
            for steps in steps_list:
                html += f'<tr><td style="padding:6px 12px;font-size:12px;font-weight:600;white-space:nowrap">Steps {steps}</td>'
                for cfg in cfgs_list:
                    wav = grid.get((add_sec, steps, cfg))
                    html += '<td style="padding:6px 12px">'
                    html += audio_tag(wav.relative_to(run_dir)) if wav and wav.exists() else '—'
                    html += '</td>'
                html += '</tr>'
            html += '</tbody></table>'

        html += "\n  </div>\n</details>"
    return html

def make_report(run_dir: Path):
    with open(CONFIG_PATH) as f:
        cfg = yaml.safe_load(f)
    prompt_pool = cfg.get("prompt_pool", [])

    gen_dir = run_dir / "1_generate"
    var_dir = run_dir / "2_variation"
    ext_dir = run_dir / "3_extend"

    s1 = build_section1(gen_dir, run_dir)
    s2 = build_section2(var_dir, run_dir, prompt_pool)
    s3 = build_section3(ext_dir, run_dir)

    nav_links = []
    if s1: nav_links.append('<a href="#section1">1 — Generate</a>')
    if s2: nav_links.append('<a href="#section2">2 — Variation</a>')
    if s3: nav_links.append('<a href="#section3">3 — Extend</a>')

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stable Audio 3 — LANDR Evaluation {run_dir.name}</title>
  <style>{CSS}</style>
</head>
<body>
<header>
  <h1>Stable Audio 3 — LANDR Evaluation</h1>
  <p>Run: {run_dir.name} &nbsp;·&nbsp; Model: small-music &nbsp;·&nbsp;
     Open this file in any browser. Audio plays directly — no internet required.</p>
</header>
<nav>{''.join(nav_links)}</nav>
<main>
"""

    if s1:
        html += f"""
  <section id="section1">
    <h2>Section 1 — Generate from Scratch</h2>
    <p class="section-desc">
      Pure text-to-audio generation. Each prompt is rendered at 4 quality levels (steps = 8 / 30 / 40 / 50)
      so you can compare speed vs. quality.<br>
      <strong>Note:</strong> all step levels use the same seed, so differences reflect model quality at that
      step count — not random variation.
    </p>
    {s1}
  </section>
"""

    if s2:
        html += f"""
  <section id="section2">
    <h2>Section 2 — Variation (Audio-to-Audio)</h2>
    <p class="section-desc">
      Each LANDR sample is varied at 3 noise levels (0.3 / 0.6 / 0.9).<br>
      <strong>Neutral prompt</strong> ("audio", cfg_scale=1.0) — variation driven by noise alone, no stylistic direction.<br>
      <strong>Creative prompt</strong> — variation steered toward a specific genre or mood.
    </p>
    {s2}
  </section>
"""

    if s3:
        html += f"""
  <section id="section3">
    <h2>Section 3 — Extend (Continuation)</h2>
    <p class="section-desc">
      Each LANDR sample is extended via inpainting across a full parameter grid.
      The original is kept intact; the model generates only the new portion.<br>
      <strong>Duration added:</strong> +5s and +15s &nbsp;·&nbsp;
      <strong>Steps:</strong> 30 and 50 &nbsp;·&nbsp;
      <strong>CFG scale:</strong> 1 (loop-like), 3 (balanced), 7 (strongly evolved)
      &nbsp;→ 12 generated files per sample.
    </p>
    {s3}
  </section>
"""

    html += "</main>\n</body>\n</html>"

    out_path = run_dir / "report.html"
    out_path.write_text(html, encoding="utf-8")
    print(f"Report written to: {out_path}")
    size_kb = out_path.stat().st_size // 1024
    print(f"File size: {size_kb} KB")
    print()
    print("To share:")
    print(f"  zip -r eval_report_{run_dir.name}.zip {run_dir}/")
    print("  Then upload the zip to Google Drive / Slack / Dropbox.")

if __name__ == "__main__":
    runs = sorted(p for p in RESULTS_DIR.iterdir() if p.is_dir())
    if not runs:
        print("No runs found in eval/results/")
        raise SystemExit(1)
    run_dir = runs[-1]
    print(f"Using run: {run_dir.name}")
    make_report(run_dir)
