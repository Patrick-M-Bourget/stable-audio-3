#!/bin/bash
# Export the eval notebook to a self-contained HTML file with embedded audio.
# Usage: bash eval/export.sh
# Then drag eval/eval.html to https://drop.netlify.com to share online.

set -e
cd "$(dirname "$0")"
source $HOME/.local/bin/env

echo "=== Stable Audio 3 — Eval Export ==="
echo ""
echo "Step 1/2 — Executing notebook (this will take a while — all sections run from scratch)..."
uv run jupyter nbconvert --to notebook --execute \
    --ExecutePreprocessor.timeout=3600 \
    --output eval_executed.ipynb \
    eval.ipynb

echo ""
echo "Step 2/2 — Exporting to HTML..."
uv run jupyter nbconvert --to html \
    --no-input \
    --output eval.html \
    eval_executed.ipynb

rm eval_executed.ipynb

SIZE=$(du -sh eval.html | cut -f1)
echo ""
echo "✅ Done — eval.html ($SIZE)"
echo ""
echo "⚠️  If the file is over 100 MB, Netlify Drop won't accept it."
echo "   In that case, use GitHub Pages or HuggingFace Spaces instead."
echo ""
echo "📤 To share:"
echo "   1. Netlify (easiest) : drag eval.html to https://drop.netlify.com"
echo "   2. GitHub Pages      : push to a repo, enable Pages in repo settings"
echo "   3. HuggingFace Spaces: create a static Space and upload eval.html"
