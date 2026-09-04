#!/usr/bin/env bash
set -euo pipefail

browser-harness < "$(dirname "$0")/repro-mode3d.py"

python3 - <<'PY'
from pathlib import Path
from PIL import Image
import numpy as np

root = Path('/tmp/diorama-repro')


def changed_pixels(a_name, b_name, threshold=8, crop=None):
    a = Image.open(root / a_name).convert('RGB')
    b = Image.open(root / b_name).convert('RGB')
    if crop:
        a = a.crop(crop)
        b = b.crop(crop)
    delta = np.abs(np.asarray(a, dtype=np.int16) - np.asarray(b, dtype=np.int16))
    return int(np.any(delta > threshold, axis=2).sum()), int(delta.max())

flat_changed, flat_max = changed_pixels('flat-3d-visible.png', 'flat-3d-hidden.png')
detached_changed, detached_max = changed_pixels('detached-visible.png', 'detached-hidden.png')
animation_changed, animation_max = changed_pixels('animation-start.png', 'animation-after-1s.png')
flat_image = Image.open(root / 'flat-3d-visible.png')
flat_ratio = flat_changed / (flat_image.width * flat_image.height)

checks = {
    # PRD A1 uses a 2% perceptual-difference ceiling. This threshold is stricter
    # than the user's obvious miniaturised duplicate while allowing raster AA drift.
    '3D mode does not add a floating duplicate page': flat_ratio < 0.02,
    'detached layer contributes visible canvas pixels': detached_changed > 50,
    'timeline playback changes the detached layer': animation_changed > 50,
}

print({
    'flat_changed_pixels': flat_changed,
    'flat_changed_ratio': round(flat_ratio, 6),
    'flat_max_delta': flat_max,
    'detached_changed_pixels': detached_changed,
    'detached_max_delta': detached_max,
    'animation_changed_pixels': animation_changed,
    'animation_max_delta': animation_max,
    'checks': checks,
})

failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit('FAIL: ' + '; '.join(failed))
print('PASS: mode 3D selection and animation render coherently')
PY
