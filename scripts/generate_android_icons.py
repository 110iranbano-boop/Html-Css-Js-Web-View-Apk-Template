#!/usr/bin/env python3
"""Generate Android launcher resources from the checked-in Simorgh feather artwork."""
import base64
from io import BytesIO
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSET = ROOT / "assets" / "android" / "simorgh-feather-foreground.png.b64"
RES = ROOT / "android" / "app" / "src" / "main" / "res"
BG = (7, 29, 36, 255)

encoded = ASSET.read_text(encoding="ascii").strip()
foreground_source = Image.open(BytesIO(base64.b64decode(encoded, validate=True))).convert("RGBA")
if foreground_source.width != foreground_source.height or foreground_source.width < 96:
    raise SystemExit(f"Expected a square source icon of at least 96px, got: {foreground_source.size}")

# Android adaptive icons use a 108dp layer; keep the artwork inside the central safe zone.
foreground = foreground_source.resize((432, 432), Image.Resampling.LANCZOS)
drawable_dir = RES / "drawable-nodpi"
drawable_dir.mkdir(parents=True, exist_ok=True)
foreground.save(drawable_dir / "ic_launcher_foreground.png", optimize=True)

values_dir = RES / "values"
values_dir.mkdir(parents=True, exist_ok=True)
(values_dir / "ic_launcher_colors.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<resources>\n'
    '    <color name="simorgh_icon_background">#071D24</color>\n'
    '</resources>\n',
    encoding="utf-8",
)

adaptive_dir = RES / "mipmap-anydpi-v26"
adaptive_dir.mkdir(parents=True, exist_ok=True)
adaptive_xml = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
    '    <background android:drawable="@color/simorgh_icon_background" />\n'
    '    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
    '</adaptive-icon>\n'
)
(adaptive_dir / "ic_launcher.xml").write_text(adaptive_xml, encoding="utf-8")
(adaptive_dir / "ic_launcher_round.xml").write_text(adaptive_xml, encoding="utf-8")

# Legacy launcher assets for Android versions/launchers that do not use adaptive icons.
bbox = foreground.getchannel("A").getbbox()
if bbox is None:
    raise SystemExit("The foreground image is fully transparent")
feather = foreground.crop(bbox)
legacy_size = 512
legacy_feather_height = 350
legacy_feather_width = round(feather.width * legacy_feather_height / feather.height)
feather = feather.resize((legacy_feather_width, legacy_feather_height), Image.Resampling.LANCZOS)
legacy = Image.new("RGBA", (legacy_size, legacy_size), BG)
legacy.alpha_composite(
    feather,
    ((legacy_size - legacy_feather_width) // 2, (legacy_size - legacy_feather_height) // 2),
)

for density, pixels in (
    ("mdpi", 48),
    ("hdpi", 72),
    ("xhdpi", 96),
    ("xxhdpi", 144),
    ("xxxhdpi", 192),
):
    folder = RES / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    icon = legacy.resize((pixels, pixels), Image.Resampling.LANCZOS)
    icon.save(folder / "ic_launcher.png", optimize=True)
    icon.save(folder / "ic_launcher_round.png", optimize=True)

print("Generated Simorgh adaptive and legacy Android launcher icons.")
