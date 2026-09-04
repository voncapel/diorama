# Diorama Agent Guide

This guide describes how to turn an existing web page into an animated 3D video using the Diorama MCP tools.

## Architecture Overview

Diorama connects your AI session to a live Google Chrome instance via a WebSocket bridge.
The architecture is split into two operational roles:
1. **Background**: Chrome service worker handling tab discovery, live DOM element candidate inspection, and page capture.
2. **Studio**: Dedicated WebGL/Canvas rendering tab running the 3D scene engine, timeline, camera tracks, keyframe evaluation, screenshots, and MP4 video rendering.

When calling tools, the bridge dispatches commands automatically to the appropriate role.

---

## Complete Workflow: From Prompt to Timeline

### Step 1: Discover and Inspect Page (`diorama_status`, `diorama_inspect_page`)
1. Call `diorama_status` to ensure both `background` and `studio` (or at least `background`) roles are connected.
2. Call `diorama_inspect_page` (optionally specifying `tabId`).
   - Returns metadata, viewport/document dimensions, and a visual `screenshotPng` image.
   - Returns `candidates`: selectable DOM elements flagged with unique selectors formatted as `[data-dio-id="N"]`.
   - Each candidate includes `rect` (page px coordinates), `inViewport`, `kind` (`hero`, `card`, `heading`, `button`, etc.), and `clusterSelectors` (similar sibling cards/elements detected by Zap clustering).
   - Check `userSelection`: if the user already interacted with the on-page picker overlay, respect their pre-selected `selectors`, `brief`, and `frameFormat`.

### Step 2: Choose Elements to Detach and Capture (`diorama_capture`)
- Select 3 to 8 high-impact elements to detach into 3D floating layers:
  - Hero element or main heading.
  - Repeating content cards or badges (use `clusterSelectors` or set `expandClusters: true`).
  - Key call-to-actions (CTA buttons).
- Call `diorama_capture` with:
  - `selectors`: list of `[data-dio-id="N"]` strings.
  - `brief`: user prompt / creative intention.
  - `frameFormat`: e.g. `'landscape-16-9'`, `'portrait-9-16'`, `'square-1-1'`.
- The background service worker detaches the selected elements, captures high-resolution textures, stores the bundle, and automatically opens the Studio tab.

### Step 3: Inspect the 3D Scene (`diorama_get_scene`)
- Call `diorama_get_scene` to inspect the newly opened studio scene.
- Key properties:
  - `layers`: detached zap layers and background layer. Notice each layer's captured `rect`, `order` (stagger sequence), and current channel `values`.
  - `channels`: animatable channels per target (`camera`, `layer`, `scene`) with their limits and units.
  - Layer transforms: positions `x`, `y`, `z` are relative pixel offsets from their captured positions. `scale` and `opacity` are percentages (default `100`).
  - Camera transforms: camera looks at the center on the plane $Z = 0$. `distance` is in pixels, `orbitX` and `orbitY` are in degrees.
  - `presets`: available pre-canned cinematic motion presets.
  - `easings`: valid easing functions (`'expo.out'`, `'quart.out'`, `'quint.inOut'`, `'cubic.inOut'`, `'back.out'`, `'linear'`).

### Step 4: Compose and Animate
1. **Frame & Duration**:
   - Call `diorama_set_frame` if you want to switch aspect ratio.
   - Call `diorama_set_duration` (typically 5 to 8 seconds).
2. **Framing (`diorama_fit`)**:
   - Use `diorama_fit` with `target: 'all'` or `target: 'viewport'` (or specific layer IDs) to frame the camera around the elements comfortably.
3. **Motion Design & Presets**:
   - Apply cinematic presets using `diorama_apply_preset`:
     - Camera presets: `dolly-in`, `dolly-out`, `orbit-reveal`, `push-tilt`, `rack-focus`, `parallax-drift`, `settle`.
     - Layer presets: `stagger-cascade`, `hero-lift`, `whip-pan`.
   - Or define granular keyframes using `diorama_set_keyframes`:
     - Target specific layers or camera channels.
     - Set `time` in seconds and `easing`.
4. **Cinematic Rules of Taste**:
   - *Single camera intent*: Avoid competing camera axes (e.g. do not combine violent pan, roll, and dolly all at once).
   - *Easing hierarchy*: Use `expo.out` or `quart.out` for crisp entries, `back.out` for subtle organic overshoot/cascades.
   - *Simplicity*: Never exceed 3 simultaneous layer motions.
   - *Keep in frame*: Ensure the focal element remains readable within the viewport safe zone.

### Step 5: Visual Verification (`diorama_contact_sheet`, `diorama_screenshot`)
1. Call `diorama_contact_sheet` with `count: 6` to inspect 6 evenly spaced thumbnails across the duration.
2. If any framing, overlap, or timing issues exist, inspect specific moments using `diorama_screenshot` with `time: <seconds>`.
3. Adjust keyframes or camera fit iteratively until the composition looks balanced, readable, and dynamic.

### Step 6: Export Final Video (`diorama_export`)
1. Call `diorama_export` with `quality: 'standard'` or `'smooth'` (and optional `motionBlurSamples: 2` or `4`).
2. The Studio tab renders the animation frame by frame into an MP4 video.
3. The bridge saves the binary MP4 to disk (under `DIORAMA_OUTPUT_DIR`, default `~/Diorama/exports/`) and returns the absolute file path along with video resolution, fps, duration, and byte size.
4. Report the resulting file path to the user.

---

## Example Sequence of Calls

### 1. Check status
```json
// Tool: diorama_status
{}
```

### 2. Inspect active page
```json
// Tool: diorama_inspect_page
{
  "screenshot": true,
  "limit": 50
}
```

### 3. Capture layers
```json
// Tool: diorama_capture
{
  "selectors": ["[data-dio-id=\"12\"]", "[data-dio-id=\"15\"]", "[data-dio-id=\"18\"]"],
  "brief": "Dramatic dolly-in reveal with floating cards",
  "frameFormat": "landscape-16-9"
}
```

### 4. Read scene setup
```json
// Tool: diorama_get_scene
{
  "keyframes": true
}
```

### 5. Setup frame and duration
```json
// Tool: diorama_set_duration
{
  "duration": 6
}
```

### 6. Fit camera to elements
```json
// Tool: diorama_fit
{
  "target": "all",
  "padding": 0.1,
  "orbitX": -8,
  "orbitY": 12
}
```

### 7. Apply animation presets
```json
// Tool: diorama_apply_preset
{
  "preset": "orbit-reveal",
  "at": 0
}
```

```json
// Tool: diorama_apply_preset
{
  "preset": "stagger-cascade",
  "at": 0.5
}
```

### 8. Inspect contact sheet
```json
// Tool: diorama_contact_sheet
{
  "count": 6
}
```

### 9. Export MP4
```json
// Tool: diorama_export
{
  "quality": "standard"
}
```

---

## Troubleshooting

- **"L'extension Diorama n'est pas connectée (rôle background). Ouvre Chrome avec l'extension chargée."**
  - Make sure Google Chrome is open, the Diorama extension is installed, and developer mode is active.
- **"L'onglet Studio n'est pas ouvert : appelle diorama_capture ou diorama_open_studio d'abord."**
  - The studio tab must be active to process 3D scene, timeline, or rendering commands. Call `diorama_capture` on a page or call `diorama_open_studio`.
- **Raster status 'fallback' or 'error' in capture**:
  - Native CDP capture might have fallen back to DOM-to-canvas rendering if CDP was detached or restricted on a protected chrome:// URL.
