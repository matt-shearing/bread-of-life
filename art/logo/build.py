#!/usr/bin/env python3
"""Bread of Life logo, "Window at dawn": source of truth and build.

An arched window at first light with a loaf on the sill. Every file in art/logo/*.svg is
written by this script, and so are the raster icons it hands to the app and the website:

    python3 art/logo/build.py                  # write the SVGs + rasters below
    pnpm tauri icon src-tauri/app-icon.json    # every desktop, iOS and Android size
    python3 art/logo/build.py --desktop-small  # swap in the simplified mark at 16-32 px

Needs: python3 with Pillow and fontTools, and `resvg` on PATH (it renders the SVGs).

What goes where
  art/logo/logo.svg              master, full-bleed square (desktop, iOS, website, README)
  art/logo/logo-rounded.svg      the master in a rounded tile (README)
  art/logo/logo-small.svg        simplified mark for 16-32 px (favicons, sidebar)
  art/logo/android-foreground.svg / android-background.svg   adaptive-icon layers, 108 dp
                                  canvas; the foreground stays inside the 66 dp safe circle
  art/logo/monochrome.svg        Android 13 themed-icon layer (one colour, same safe zone)
  art/logo/notification.svg      white-on-transparent status-bar silhouette (24 dp)
  art/logo/wordmark.svg / wordmark-dark.svg   mark + "Bread of Life" (Merriweather 700,
                                  outlined, so no font is needed to show it)
  src-tauri/app-icon.png + app-icon-{fg,bg,mono}.png + app-icon.json  → `tauri icon`
  src-tauri/plugins/native-audio/android/src/main/res/drawable/ic_notification.xml
  public/favicon.png; src/assets/logo.svg + logo-small.svg (in-app brand mark)
  website/img/logo-96.webp, favicon.ico, favicon-32.png, apple-touch-icon.png, og.png

No SVG here uses filters: Android vector drawables cannot draw blur, and the soft light on
the wall is done with gradients instead.
"""
from __future__ import annotations

import io
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

# ---------------------------------------------------------------------------- palette
WALL_IN, WALL_MID, WALL_OUT = "#5e4834", "#4d3a2a", "#463526"   # lighter than round 2's ground
REVEAL_TOP, REVEAL_BOT = "#a67a50", "#6b4a31"
SKY = [(0, "#fff8e8"), (0.5, "#fde6b4"), (0.82, "#f9bd55"), (1, "#f29b17")]
HILL_TOP, HILL_BOT = "#e0911f", "#b8600c"
SILL_TOP, SILL_MID, SILL_BOT = "#caa079", "#936744", "#5d402b"
LOAF_TOP, LOAF_BOT = "#7a4a27", "#301c0f"
RIM = "#ffc978"
SCORE = "#f0ae55"

# ---------------------------------------------------------------------------- geometry
# Drawn on a 1024 canvas at "adaptive" scale: the whole foreground sits inside the 66 dp
# safe circle of the 108 dp canvas (radius 1024 * 33/108 = 312.9 px around 512,512).
OUTER = "M322 718 V448 A190 190 0 0 1 702 448 V718Z"
INNER = "M360 706 V448 A152 152 0 0 1 664 448 V706Z"
HILL = "M360 646 C436 614 540 610 664 636 V706 H360Z"
SILL = dict(x=298, y=702, w=428, h=34, rx=8)
LOAF = ("M430 704 C404 704 396 680 404 660 C418 626 460 604 512 604 "
        "C564 604 606 626 620 660 C628 680 620 704 594 704Z")
LOAF_RIM = "M410 654 C428 624 466 608 512 607 C558 608 596 624 614 654"
LOAF_SCORE = "M446 656 C456 640 468 630 482 624 M494 650 C504 634 516 624 530 618 M542 652 C552 636 564 628 578 624"


def defs(uid: str = "") -> str:
    u = uid
    sky = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in SKY)
    return f"""<defs>
 <radialGradient id="wall{u}" cx="512" cy="470" r="620" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{WALL_IN}"/><stop offset=".6" stop-color="{WALL_MID}"/><stop offset="1" stop-color="{WALL_OUT}"/></radialGradient>
 <radialGradient id="glow{u}" cx="512" cy="520" r="330" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f7b54a" stop-opacity=".32"/><stop offset=".6" stop-color="#f7b54a" stop-opacity=".1"/><stop offset="1" stop-color="#f7b54a" stop-opacity="0"/></radialGradient>
 <radialGradient id="spill{u}"><stop offset="0" stop-color="#f7b54a" stop-opacity=".34"/><stop offset=".5" stop-color="#f7b54a" stop-opacity=".14"/><stop offset="1" stop-color="#f7b54a" stop-opacity="0"/></radialGradient>
 <linearGradient id="reveal{u}" x1="0" y1="258" x2="0" y2="718" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{REVEAL_TOP}"/><stop offset="1" stop-color="{REVEAL_BOT}"/></linearGradient>
 <linearGradient id="sky{u}" x1="0" y1="296" x2="0" y2="706" gradientUnits="userSpaceOnUse">{sky}</linearGradient>
 <linearGradient id="hill{u}" x1="0" y1="612" x2="0" y2="706" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{HILL_TOP}" stop-opacity=".6"/><stop offset="1" stop-color="{HILL_BOT}" stop-opacity=".8"/></linearGradient>
 <linearGradient id="sill{u}" x1="0" y1="702" x2="0" y2="736" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{SILL_TOP}"/><stop offset=".3" stop-color="{SILL_MID}"/><stop offset="1" stop-color="{SILL_BOT}"/></linearGradient>
 <linearGradient id="loaf{u}" x1="0" y1="608" x2="0" y2="704" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{LOAF_TOP}"/><stop offset="1" stop-color="{LOAF_BOT}"/></linearGradient>
 <linearGradient id="shade{u}" x1="0" y1="718" x2="0" y2="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1a120c" stop-opacity=".32"/><stop offset="1" stop-color="#1a120c" stop-opacity="0"/></linearGradient>
</defs>"""


def background(u: str = "", t: str = "") -> str:
    """The wall: a warm plaster ground, a glow round the window and light spilling below.
    `t` places the light where the window is (the same transform as the foreground)."""
    return (f'<rect width="1024" height="1024" fill="url(#wall{u})"/>'
            f'<g transform="{t}"><rect x="-512" y="-512" width="2048" height="2048" fill="url(#glow{u})"/>'
            f'<ellipse cx="512" cy="736" rx="250" ry="120" fill="url(#spill{u})"/></g>')


def foreground(u: str = "") -> str:
    s = SILL
    return (
        f'<path d="M298 736 H726 V760 H298Z" fill="url(#shade{u})"/>'
        f'<path d="{OUTER}" fill="url(#reveal{u})"/>'
        f'<path d="{INNER}" fill="url(#sky{u})"/>'
        f'<path d="{HILL}" fill="url(#hill{u})"/>'
        f'<rect x="{s["x"]}" y="{s["y"]}" width="{s["w"]}" height="{s["h"]}" rx="{s["rx"]}" fill="url(#sill{u})"/>'
        f'<path d="{LOAF}" fill="url(#loaf{u})"/>'
        f'<path d="{LOAF_RIM}" fill="none" stroke="{RIM}" stroke-width="4" stroke-linecap="round" opacity=".6"/>'
        f'<path d="{LOAF_SCORE}" fill="none" stroke="{SCORE}" stroke-width="7" stroke-linecap="round" opacity=".7"/>'
    )


def svg(body: str, comment: str, size: int = 1024) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">\n'
            f"<!-- {comment} -->\n{body}\n</svg>\n")


# Full-bleed master: the same drawing, larger, for platforms that show the whole square.
FULL = "translate(512 497) scale(1.26) translate(-512 -497)"
# Adaptive layers: nudged up and grown until the sill's corners touch the 66 dp circle.
ADAPT = "translate(512 512) scale(1.03) translate(-512 -522)"


def master() -> str:
    return svg(defs() + f'<g id="background">{background("", FULL)}</g>'
               f'<g id="foreground" transform="{FULL}">{foreground()}</g>',
               'Bread of Life, "Window at dawn". Master, full-bleed. Generated by art/logo/build.py.')


def rounded() -> str:
    """The master in a rounded tile with transparent corners (README, documents)."""
    return svg('<clipPath id="tile"><rect width="1024" height="1024" rx="230"/></clipPath>'
               + defs() + f'<g clip-path="url(#tile)">{background("", FULL)}'
               f'<g transform="{FULL}">{foreground()}</g></g>',
               "Bread of Life mark in a rounded tile. Generated by art/logo/build.py.")


def android_fg() -> str:
    return svg(defs() + f'<g id="foreground" transform="{ADAPT}">{foreground()}</g>',
               "Adaptive-icon foreground (108 dp canvas; everything inside the 66 dp safe circle).")


def android_bg() -> str:
    return svg(defs() + f'<g id="background">{background("", ADAPT)}</g>', "Adaptive-icon background: the wall.")


# Small-size variant: the window fills the tile, the frame is heavier and the detail goes.
def small() -> str:
    return svg(
        f"""<defs>
 <linearGradient id="w" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{WALL_IN}"/><stop offset="1" stop-color="{WALL_OUT}"/></linearGradient>
 <linearGradient id="r" x1="0" y1="120" x2="0" y2="800" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{REVEAL_TOP}"/><stop offset="1" stop-color="{REVEAL_BOT}"/></linearGradient>
 <linearGradient id="s" x1="0" y1="200" x2="0" y2="790" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff5de"/><stop offset=".55" stop-color="#fcd98f"/><stop offset="1" stop-color="#f29b17"/></linearGradient>
</defs>
<rect width="1024" height="1024" fill="url(#w)"/>
<path d="M212 800 V430 A300 300 0 0 1 812 430 V800Z" fill="url(#r)"/>
<path d="M290 790 V430 A222 222 0 0 1 734 430 V790Z" fill="url(#s)"/>
<path d="M390 792 C352 792 344 752 356 726 C378 680 438 652 512 652 C586 652 646 680 668 726 C680 752 672 792 634 792Z" fill="#3a2314"/>
<rect x="160" y="786" width="704" height="84" rx="16" fill="#b8895e"/>""",
        "Small-size variant (16-32 px): bigger window, heavier frame, no fine detail.")


# One-colour silhouettes. Android themed icons tint the monochrome layer; the arch ring,
# the lit pane with the loaf cut out of it, and the sill.
def mono_body(fill: str = "#000") -> str:
    loaf_hole = f'<path d="{LOAF}" transform="translate(512 704) scale(1.1) translate(-512 -704)"/>'
    return (f'<g fill="{fill}" transform="{ADAPT}">'
            f'<path fill-rule="evenodd" d="{OUTER} M344 706 V448 A168 168 0 0 1 680 448 V706Z"/>'
            f'<mask id="m"><path fill="#fff" d="M364 704 V448 A148 148 0 0 1 660 448 V704Z"/>'
            f'<g fill="#000">{loaf_hole}</g>'
            f'<path d="{LOAF_SCORE}" transform="translate(512 704) scale(1.1) translate(-512 -704)" '
            f'fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round"/></mask>'
            f'<rect width="1024" height="1024" mask="url(#m)"/>'
            f'<rect x="{SILL["x"]}" y="{SILL["y"] - 4}" width="{SILL["w"]}" height="{SILL["h"] + 6}" rx="{SILL["rx"]}"/>'
            f"</g>")


def mono() -> str:
    return svg(mono_body(), "Android 13+ themed-icon layer (monochrome). Same safe zone as the foreground.")


# Status-bar icon, 24 dp: filled pane with the loaf knocked out, on the sill.
NOTIF_PATH = ("M4 20.2 V10.5 A8 8 0 0 1 20 10.5 V20.2 Z "
              "M7.2 20.2 C7.2 16.6 9.2 14.6 12 14.5 C14.8 14.6 16.8 16.6 16.8 20.2 Z")
NOTIF_SILL = "M2.5 20.2 H21.5 A0.8 0.8 0 0 1 22.3 21 V21.9 A0.8 0.8 0 0 1 21.5 22.7 H2.5 A0.8 0.8 0 0 1 1.7 21.9 V21 A0.8 0.8 0 0 1 2.5 20.2 Z"


def notification_svg() -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">\n'
            f"<!-- Status-bar silhouette: white on transparent. -->\n"
            f'<path fill="#fff" fill-rule="evenodd" d="{NOTIF_PATH}"/><path fill="#fff" d="{NOTIF_SILL}"/>\n</svg>\n')


def notification_xml() -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Bread of Life status-bar icon: the arched window with the loaf on the sill, as a white
     silhouette. NativeAudioService and tauri-plugin-notification look it up by name
     ("ic_notification"). Generated by art/logo/build.py. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:fillType="evenOdd"
        android:pathData="{NOTIF_PATH}" />
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="{NOTIF_SILL}" />
</vector>
"""


# ---------------------------------------------------------------------------- wordmark
def text_path(text: str, font_path: Path, size: float, x: float, baseline: float, weight: float = 700):
    """Outline `text` in the given font (pair kerning from GPOS), as one SVG path + width."""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont
    font = TTFont(font_path)
    if "fvar" in font:
        from fontTools.varLib.instancer import instantiateVariableFont
        font = instantiateVariableFont(font, {"wght": weight})
    upem = font["head"].unitsPerEm
    cmap, gs, hmtx = font.getBestCmap(), font.getGlyphSet(), font["hmtx"]
    kern = _pair_kerning(font)
    k = size / upem
    names = [cmap[ord(c)] for c in text]
    pen = SVGPathPen(gs)
    cx = 0.0
    for i, g in enumerate(names):
        gs[g].draw(TransformPen(pen, (k, 0, 0, -k, x + cx * k, baseline)))
        cx += hmtx[g][0]
        if i + 1 < len(names):
            cx += kern.get((g, names[i + 1]), 0)
    return pen.getCommands(), cx * k


def _pair_kerning(font) -> dict:
    out: dict = {}
    if "GPOS" not in font:
        return out
    gpos = font["GPOS"].table
    for li in gpos.FeatureList.FeatureRecord:
        if li.FeatureTag != "kern":
            continue
        for idx in li.Feature.LookupListIndex:
            lk = gpos.LookupList.Lookup[idx]
            for st in lk.SubTable:
                if lk.LookupType == 9:
                    st = st.ExtSubTable
                if getattr(st, "LookupType", 2) != 2 and lk.LookupType not in (2, 9):
                    continue
                if st.Format == 1:
                    for first, ps in zip(st.Coverage.glyphs, st.PairSet):
                        for pvr in ps.PairValueRecord:
                            v = getattr(pvr.Value1, "XAdvance", 0) or 0
                            out.setdefault((first, pvr.SecondGlyph), v)
                elif st.Format == 2:
                    c1, c2 = st.ClassDef1.classDefs, st.ClassDef2.classDefs
                    for first in st.Coverage.glyphs:
                        rec = st.Class1Record[c1.get(first, 0)]
                        for second, cls2 in list(c2.items()):
                            v = getattr(rec.Class2Record[cls2].Value1, "XAdvance", 0) or 0
                            if v:
                                out.setdefault((first, second), v)
    return out


def wordmark(dark: bool) -> str:
    font = ROOT / "website/fonts/bol-serif-latin.woff2"   # Merriweather, renamed subset
    ink = "#f6ecdc" if dark else "#2a2018"
    d, w = text_path("Bread of Life", font, 150, 296, 196)
    width = int(296 + w + 24)
    # The mark as a rounded tile, 240 px, vertically centred on the text's x-height band.
    tile = (f'<svg x="20" y="20" width="240" height="240" viewBox="0 0 1024 1024">'
            f'<defs><clipPath id="tc"><rect width="1024" height="1024" rx="230"/></clipPath></defs>'
            f'<g clip-path="url(#tc)">{defs("W")}{background("W", FULL)}<g transform="{FULL}">{foreground("W")}</g></g></svg>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 280" width="{width}" height="280">\n'
            f'<!-- Bread of Life wordmark ({"dark" if dark else "light"} backgrounds). Text is Merriweather 700, outlined. -->\n'
            f'{tile}\n<path fill="{ink}" d="{d}"/>\n</svg>\n')


# ---------------------------------------------------------------------------- rendering
def render(svg_text: str, size: int, w: int | None = None, h: int | None = None) -> Image.Image:
    with tempfile.TemporaryDirectory() as td:
        src, dst = Path(td, "in.svg"), Path(td, "out.png")
        src.write_text(svg_text)
        args = ["resvg", str(src), str(dst)]
        args += ["-w", str(w or size), "-h", str(h or size)]
        subprocess.run(args, check=True)
        return Image.open(dst).convert("RGBA").copy()


def downscale(img: Image.Image, n: int) -> Image.Image:
    return img.resize((n, n), Image.LANCZOS)


def write_png(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print("wrote", path.relative_to(ROOT))


def main() -> None:
    files = {
        "logo.svg": master(), "logo-rounded.svg": rounded(), "logo-small.svg": small(),
        "android-foreground.svg": android_fg(), "android-background.svg": android_bg(),
        "monochrome.svg": mono(), "notification.svg": notification_svg(),
        "wordmark.svg": wordmark(False), "wordmark-dark.svg": wordmark(True),
    }
    for name, text in files.items():
        (HERE / name).write_text(text)
        print("wrote", (HERE / name).relative_to(ROOT))

    big = render(files["logo.svg"], 1024)
    sm = render(files["logo-small.svg"], 1024)

    # Tauri: `pnpm tauri icon src-tauri/app-icon.json` (manifest below) makes every size.
    st = ROOT / "src-tauri"
    write_png(big.convert("RGB"), st / "app-icon.png")
    write_png(render(files["android-foreground.svg"], 1024), st / "app-icon-fg.png")
    write_png(render(files["android-background.svg"], 1024).convert("RGB"), st / "app-icon-bg.png")
    write_png(render(files["monochrome.svg"], 1024), st / "app-icon-mono.png")

    res = st / "plugins/native-audio/android/src/main/res/drawable/ic_notification.xml"
    res.write_text(notification_xml())
    print("wrote", res.relative_to(ROOT))

    # The app's web side.
    pub = ROOT / "public"
    write_png(downscale(sm, 64), pub / "favicon.png")
    assets = ROOT / "src/assets"
    assets.mkdir(exist_ok=True)
    (assets / "logo.svg").write_text(files["logo.svg"])
    (assets / "logo-small.svg").write_text(files["logo-small.svg"])

    # Website.
    web = ROOT / "website"
    buf = io.BytesIO()
    downscale(big, 96).save(buf, "WEBP", quality=92, method=6)
    (web / "img/logo-96.webp").write_bytes(buf.getvalue())
    print("wrote website/img/logo-96.webp")
    write_png(downscale(sm, 32).convert("RGB"), web / "favicon-32.png")
    write_png(downscale(big, 180).convert("RGB"), web / "apple-touch-icon.png")
    ico48 = downscale(big, 48)
    ico48.save(web / "favicon.ico", sizes=[(48, 48), (32, 32), (16, 16)],
               append_images=[downscale(sm, 32), downscale(sm, 16)])
    print("wrote website/favicon.ico")

    # og.png keeps its layout (headline + phone); only the 44 px brand tile changes.
    og = Image.open(web / "og.png").convert("RGB")
    x, y, n = 72, 64, 44
    og.paste(og.getpixel((20, 20)), (x - 2, y - 2, x + n + 2, y + n + 2))
    from PIL import ImageDraw
    m = Image.new("L", (n * 4, n * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, n * 4 - 1, n * 4 - 1], radius=48, fill=255)
    og.paste(downscale(big, n).convert("RGB"), (x, y), m.resize((n, n), Image.LANCZOS))
    write_png(og, web / "og.png")


def desktop_small() -> None:
    """After `tauri icon`: the 16, 24 and 32 px desktop icons use the simplified mark."""
    sm = render(small(), 1024)
    icons = ROOT / "src-tauri/icons"
    write_png(downscale(sm, 32), icons / "32x32.png")
    ico = Image.open(icons / "icon.ico")
    sizes = sorted(ico.info["sizes"])
    frames = {}
    for w, h in sizes:
        ico.size = (w, h)
        frames[w] = ico.copy().convert("RGBA")
        ico = Image.open(icons / "icon.ico")
    for n in (16, 24, 32):
        if n in frames:
            frames[n] = downscale(sm, n)
    order = [frames[w] for w, _ in sizes]
    order[-1].save(icons / "icon.ico", sizes=sizes, append_images=order[:-1])
    print("wrote src-tauri/icons/icon.ico (16-32 px from logo-small.svg)")


if __name__ == "__main__":
    sys.exit(desktop_small() if "--desktop-small" in sys.argv else main())
