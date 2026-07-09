#!/usr/bin/env python3
"""
Generate "Bread of Life" dashboard backgrounds with Nano Banana Pro (Gemini 3 Pro Image).

Reads prompts.json (a list of {out, prompt, aspect_ratio, refs?}) and writes each
image to <project-root>/<out> (e.g. "public/backgrounds/countryside-day.webp").
Idempotent: skips files that already exist unless --force.

Mirrors the Frollilump Tales image-gen pipeline, but saves optimized .webp
(resized to <=1920px wide, quality 82) suitable as a UI background.

Run with the Frollilump venv (it has google-genai + pillow):
    /home/contra/dev/frollilump-tales/.venv/bin/python generate.py
    ... generate.py --force            # regenerate everything
    ... generate.py countryside-day    # just those (match by 'out' basename)

Key: reads GEMINI_API_KEY / GOOGLE_API_KEY from env. Never printed.
Consistency: "refs":["public/backgrounds/countryside-day.webp"] on the dusk item
feeds the day image back in so the scene matches.
"""
import json, os, sys, mimetypes
from pathlib import Path

MODELS = [os.environ.get("NANO_BANANA_MODEL", "gemini-3-pro-image"),
          "gemini-3-pro-image-preview"]
MAXW = int(os.environ.get("MAXW", "1920"))
WEBP_QUALITY = int(os.environ.get("WEBP_QUALITY", "82"))
HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent                    # bread-of-life-2026/
PROMPTS = HERE / "prompts.json"


def load_key():
    """env var, then a keys.md walked up from here. Never printed."""
    k = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if k:
        return k.strip()
    import re as _re
    d = HERE
    for _ in range(10):
        f = d / "keys.md"
        if f.exists():
            m = _re.search(r"Google API Key\s*[-:]\s*([A-Za-z0-9._\-]+)", f.read_text())
            if m:
                return m.group(1).strip()
        if d.parent == d:
            break
        d = d.parent
    return None


def resolve_ref(ref):
    """Resolve a reference image path: try project-relative, then a few dirs."""
    for p in (PROJECT / ref, HERE / ref, Path(ref)):
        if p.exists():
            return p
    return None


def main():
    argv = sys.argv[1:]
    force = "--force" in argv
    args = [a for a in argv if not a.startswith("-")]
    key = load_key()
    if not key:
        sys.exit("No key: set GEMINI_API_KEY or add keys.md with 'Google API Key - <key>'.")

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        sys.exit("pip install google-genai pillow (use the project .venv)")

    client = genai.Client(api_key=key)
    items = json.loads(PROMPTS.read_text())
    if args:
        items = [it for it in items if it["out"] in args or Path(it["out"]).stem in args]

    for it in items:
        out = PROJECT / it["out"]
        if out.exists() and not force:
            print(f"skip  {it['out']} (exists — use --force)"); continue
        out.parent.mkdir(parents=True, exist_ok=True)

        try:
            cfg = types.GenerateContentConfig(
                image_config=types.ImageConfig(aspect_ratio=it.get("aspect_ratio", "16:9")))
        except Exception:
            cfg = None

        contents = []
        for ref in it.get("refs", []):
            rp = resolve_ref(ref)
            if not rp:
                print(f"  !! reference not found: {ref}"); continue
            mime = mimetypes.guess_type(str(rp))[0] or "image/webp"
            contents.append(types.Part.from_bytes(data=rp.read_bytes(), mime_type=mime))
        contents.append(it["prompt"])

        print(f"gen   {it['out']} ({len(contents)-1} ref) ...", flush=True)
        resp, last_err = None, None
        for model in MODELS:
            try:
                resp = client.models.generate_content(model=model, contents=contents, config=cfg)
                break
            except Exception as e:
                last_err = e
                print(f"  .. model {model} failed ({str(e)[:100]}); trying next", flush=True)
        if resp is None:
            print(f"  !! all models failed for {it['out']}: {str(last_err)[:200]}"); continue

        data = None
        for part in resp.candidates[0].content.parts:
            inline = getattr(part, "inline_data", None)
            if inline and inline.data:
                data = inline.data; break
        if not data:
            print(f"  !! no image for {it['out']} (text: {getattr(resp,'text','')[:160]})"); continue

        raw = out.with_suffix(".raw.png")
        raw.write_bytes(data)
        try:
            from PIL import Image
            img = Image.open(raw).convert("RGB")
            if img.width > MAXW:
                img = img.resize((MAXW, round(img.height * MAXW / img.width)))
            img.save(out, "WEBP", quality=WEBP_QUALITY, method=6)
            raw.unlink()
        except Exception as e:
            print(f"  !! PIL save failed ({e}); wrote raw bytes"); out.write_bytes(data); raw.unlink(missing_ok=True)
        print(f"  ->  {it['out']}  ({out.stat().st_size//1024} KB)")

    print("done.")


if __name__ == "__main__":
    main()
