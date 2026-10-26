#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later

import os
from PIL import Image

src_path = "languages/modelscript/assets/icon-dark.png"
icons_dir = "apps/desktop/src-tauri/icons"
os.makedirs(icons_dir, exist_ok=True)

img = Image.open(src_path).convert("RGBA")

# Create a square 512x512 canvas with transparent background and center the logo
size = 512
square = Image.new("RGBA", (size, size), (0, 0, 0, 0))
# Scale source image to fit with padding
aspect = img.width / img.height
if aspect >= 1.0:
    w = 420
    h = int(w / aspect)
else:
    h = 420
    w = int(h * aspect)

resized = img.resize((w, h), Image.Resampling.LANCZOS)
offset_x = (size - w) // 2
offset_y = (size - h) // 2
square.paste(resized, (offset_x, offset_y), resized)

# Save standard icons
square.resize((32, 32), Image.Resampling.LANCZOS).save(os.path.join(icons_dir, "32x32.png"))
square.resize((128, 128), Image.Resampling.LANCZOS).save(os.path.join(icons_dir, "128x128.png"))
square.resize((256, 256), Image.Resampling.LANCZOS).save(os.path.join(icons_dir, "128x128@2x.png"))
square.save(os.path.join(icons_dir, "icon.png"))

# Save multi-size .ico
ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
square.save(os.path.join(icons_dir, "icon.ico"), format="ICO", sizes=ico_sizes)

# Save placeholder or valid icns
square.resize((256, 256), Image.Resampling.LANCZOS).save(os.path.join(icons_dir, "icon.icns"), format="ICNS")

print(f"Successfully generated all desktop icons in {icons_dir}")
