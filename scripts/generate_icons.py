#!/usr/bin/env python3
"""
Generate the icon set Tauri requires:
  icons/32x32.png, 128x128.png, 128x128@2x.png (256x256),
  icon.ico (Windows multi-res), icon.icns (macOS).
We render a simple "iPhone-ish" rounded square with the ipatool-gui brand
(initial "i" on a blue gradient). No external assets required.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

def find_font() -> str | None:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None

FONT = find_font()

def render(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # rounded-square background
    pad = max(2, size // 16)
    radius = max(4, size // 5)
    # gradient: top-left blue -> bottom-right indigo
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(91 * (1 - t) + 99 * t)
        g = int(141 * (1 - t) + 102 * t)
        b = int(239 * (1 - t) + 241 * t)
        for x in range(size):
            # only set inside the rounded rect to keep transparency
            ix, iy = x, y
            # inside rounded rect test
            inside = True
            # check corners
            for cx, cy, sx, sy in [
                (pad + radius, pad + radius, -1, -1),
                (size - pad - radius, pad + radius, 1, -1),
                (pad + radius, size - pad - radius, -1, 1),
                (size - pad - radius, size - pad - radius, 1, 1),
            ]:
                dx = (ix - cx) * sx
                dy = (iy - cy) * sy
                if dx > 0 and dy > 0 and (dx * dx + dy * dy) > radius * radius:
                    inside = False
                    break
            if not (pad <= ix <= size - pad and pad <= iy <= size - pad):
                inside = False
            if inside:
                img.putpixel((x, y), (r, g, b, 255))
    # subtle outer ring
    d.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=radius,
        outline=(255, 255, 255, 60),
        width=max(1, size // 64),
    )
    # letter "i"
    if FONT:
        font_size = int(size * 0.55)
        fnt = ImageFont.truetype(FONT, font_size)
        text = "i"
        bbox = d.textbbox((0, 0), text, font=fnt)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = (size - tw) // 2 - bbox[0]
        ty = (size - th) // 2 - bbox[1]
        # subtle shadow
        d.text((tx + max(1, size // 128), ty + max(1, size // 128)),
               text, font=fnt, fill=(0, 0, 0, 80))
        d.text((tx, ty), text, font=fnt, fill=(255, 255, 255, 255))
    return img

# PNGs
for name, sz in [
    ("32x32.png", 32),
    ("128x128.png", 128),
    ("128x128@2x.png", 256),
    ("icon.png", 512),
    ("Square30x30Logo.png", 30),
    ("Square44x44Logo.png", 44),
    ("Square71x71Logo.png", 71),
    ("Square89x89Logo.png", 89),
    ("Square107x107Logo.png", 107),
    ("Square142x142Logo.png", 142),
    ("Square150x150Logo.png", 150),
    ("Square284x284Logo.png", 284),
    ("Square310x310Logo.png", 310),
    ("StoreLogo.png", 50),
]:
    render(sz).save(OUT / name)

# Windows ICO (multi-res)
Image.open(OUT / "128x128.png").resize((16, 16)).save(OUT / "icon.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])

# macOS ICNS — Pillow can write icns directly if version >= 8.0
try:
    Image.open(OUT / "icon.png").save(OUT / "icon.icns")
except Exception as e:
    print(f"icns save failed: {e}", flush=True)

print("Generated icons in", OUT)
for p in sorted(OUT.iterdir()):
    print(" ", p.name, p.stat().st_size)
