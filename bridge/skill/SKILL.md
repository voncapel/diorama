---
name: diorama
description: Turn a live web page into an animated 3D video via the Diorama MCP tools.
---

# Diorama Workflow

Use the `diorama_*` MCP tools to capture web pages from Chrome into 3D scenes, compose camera and layer animations, and render MP4 videos.

## 1. Inspect
- Check readiness with `diorama_status`.
- Call `diorama_inspect_page` to retrieve the viewport screenshot and selectable elements (`candidates` with `[data-dio-id="N"]` selectors, `clusterSelectors`, `rect`, and `kind`).
- If `userSelection` is present, reuse the user's selected elements and brief.

## 2. Capture
- Choose 3 to 8 elements (hero, card cluster, CTA buttons).
- Call `diorama_capture({ selectors: [...], brief: "...", frameFormat: "landscape-16-9" })`.
- This detaches elements, extracts textures, and opens the Studio renderer tab.

## 3. Setup Scene & Framing
- Call `diorama_get_scene` to inspect layers, camera parameters, channels, presets, and easings.
- Adjust duration with `diorama_set_duration({ duration: 6 })`.
- Frame the composition with `diorama_fit({ target: "all", padding: 0.1, orbitX: -8, orbitY: 12 })`.

## 4. Animate
- Apply motion presets: `diorama_apply_preset({ preset: "orbit-reveal" })` or `diorama_apply_preset({ preset: "stagger-cascade" })`.
- Or set custom keyframes via `diorama_set_keyframes`.
- Rules of taste: 1 camera intention per shot; easing `expo.out` for entries, `back.out` for cascades; max 3 simultaneous motions.

## 5. Review & Export
- Check progress with `diorama_contact_sheet({ count: 6 })` or spot-check with `diorama_screenshot({ time: ... })`.
- Render final video with `diorama_export({ quality: "standard" })`.
- Report the saved MP4 path back to the user.
