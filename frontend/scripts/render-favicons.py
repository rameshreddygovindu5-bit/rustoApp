#!/usr/bin/env python3
"""Render all favicon + PWA icons from the Rusto logo design (v4).

Usage:
    cd frontend && python3 scripts/render-favicons.py

This script's geometry mirrors src/components/RustoLogo/RustoLogo.jsx
exactly. If the React component design changes, update both.

Produces:
- public/favicon.png (32x32)
- public/icons/icon-{32,48,64,128,192,256,384,512}.png
- public/icons/apple-touch-icon.png (180x180)
- public/icons/maskable-{192,512}.png (Android adaptive icons)
"""
from PIL import Image, ImageDraw
import os, sys

# ── Brand colors (must match src/index.css + tailwind.config.js) ────
NAVY    = (15, 27, 51)       # #0F1B33
GOLD_DK = (168, 135, 60)     # #A8873C
GOLD_LT = (226, 196, 112)    # #E2C470


def gold_gradient(w, h):
    """Diagonal light→dark gold gradient for the tile background."""
    grad = Image.new('RGB', (w, h), GOLD_LT)
    px = grad.load()
    for y in range(h):
        for x in range(w):
            t = (x + y) / (w + h - 2) if (w + h) > 2 else 0
            px[x, y] = tuple(
                int(GOLD_LT[i] * (1 - t) + GOLD_DK[i] * t) for i in range(3)
            )
    return grad


def rounded_mask(size, radius_pct=0.22):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1],
        radius=int(size * radius_pct), fill=255,
    )
    return mask


def render_logo(size, tile=True, padding_pct=0.17):
    """Render the v4 logo (two peaks + hammock + sun) at `size` pixels."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if tile:
        grad = gold_gradient(size, size).convert('RGBA')
        img.paste(grad, (0, 0), rounded_mask(size, 0.22))

    # Logical 48x48 canvas (matching the SVG viewBox).
    pad = size * padding_pct
    safe_w = size - 2 * pad
    scale = safe_w / 48.0
    ox = pad - 4 * scale
    oy = pad - 5 * scale

    # Supersample 4x for smooth strokes
    SS = 4
    layer = Image.new('RGBA', (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    def Lss(x, y):
        return (SS * (ox + x * scale), SS * (oy + y * scale))

    stroke_w = max(2, int(scale * 2.6 * SS))
    hammock_w = max(2, int(scale * 2.3 * SS))

    # Two mountain peaks
    mountain = [Lss(*pt) for pt in [
        (4, 32), (14, 32), (19, 18), (24, 32),
        (29, 22), (34, 32), (44, 32),
    ]]
    d.line(mountain, fill=NAVY, width=stroke_w, joint='curve')
    for p in [mountain[0], mountain[2], mountain[4], mountain[-1]]:
        r = stroke_w // 2
        d.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill=NAVY)

    # Hammock (quadratic Bezier sampled)
    hammock = []
    for i in range(21):
        t = i / 20.0
        x = (1-t)**2 * 12 + 2*(1-t)*t * 24 + t**2 * 36
        y = (1-t)**2 * 42 + 2*(1-t)*t * 50 + t**2 * 42
        hammock.append(Lss(x, y))
    d.line(hammock, fill=NAVY, width=hammock_w, joint='curve')
    for p in [hammock[0], hammock[-1]]:
        r = hammock_w // 2
        d.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill=NAVY)

    # Sun
    sun_x, sun_y = Lss(24, 7)
    sun_r = scale * 2.6 * SS
    d.ellipse([sun_x-sun_r, sun_y-sun_r, sun_x+sun_r, sun_y+sun_r], fill=NAVY)

    return Image.alpha_composite(img, layer.resize((size, size), Image.LANCZOS))


def main():
    # Find frontend root (script lives in frontend/scripts/)
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    icons_dir = os.path.join(root, "public", "icons")
    os.makedirs(icons_dir, exist_ok=True)

    for sz in [32, 48, 64, 128, 192, 256, 384, 512]:
        render_logo(sz).save(
            os.path.join(icons_dir, f"icon-{sz}.png"), "PNG", optimize=True
        )

    render_logo(180).save(
        os.path.join(icons_dir, "apple-touch-icon.png"), "PNG", optimize=True
    )

    # Maskable: full-bleed gold + 60% safe-zone mark
    for sz in [192, 512]:
        img = Image.new('RGBA', (sz, sz), (0, 0, 0, 0))
        img.paste(gold_gradient(sz, sz).convert('RGBA'), (0, 0))
        inner = render_logo(int(sz * 0.6), tile=False, padding_pct=0.05)
        off = (sz - int(sz * 0.6)) // 2
        img.alpha_composite(inner, (off, off))
        img.save(
            os.path.join(icons_dir, f"maskable-{sz}.png"), "PNG", optimize=True
        )

    render_logo(32).save(
        os.path.join(root, "public", "favicon.png"), "PNG", optimize=True
    )
    print("✓ All favicons + PWA icons regenerated")


if __name__ == "__main__":
    main()
