# Brief refacto Studio Diorama

Contexte : `src/studio/` est le Studio 3D (React 19 + zustand + three 0.179, Vite, extension Chrome MV3,
onglet `studio.html`). Le cœur du nouveau modèle est **déjà écrit et ne doit pas être modifié** sans
raison bloquante (le signaler dans le rapport) :

- `src/studio/model/channels.ts` : registre des canaux animables (layer / camera / scene), défauts, clamp, groupes.
- `src/studio/model/timeline.ts` : keyframes (`{id, layerId|null, channel, time, value, easing}`), `evaluateTimeline`,
  `resolveLayerValues/resolveCameraValues/resolveSceneValues`, `keyframeTimes`, `snapTime`, `groupTracks`.
- `src/studio/store.ts` : état global. Clés : `layers: Record<id, LayerState{values, visible, locked, castShadow, backgroundColor}>`,
  `camera: CameraValues`, `scene: SceneValues`, `sceneSettings{lightEnabled, dofEnabled}`, `frame`, `keyframes`,
  `duration`, `playhead`, `playing`, `autoKey`, `selection: string[]`, `hoveredLayerId`, `tool: 'select'|'orbit'`,
  `inspector: 'layer'|'camera'|'scene'|'frame'|'export'`, `timelineUi{height, zoom(px/s), scroll(s), expanded[], snap}`,
  export*. Actions : `setLayerValue(id, channel, v)` (autoKey), `setLayerValues`, `setLayerFlags`, `setCameraValue(s)`,
  `setSceneValue`, `setSceneSettings`, `select(ids, 'replace'|'toggle'|'add')`, `keyAtPlayhead`, `toggleKeyAtPlayhead`,
  `moveKeyframes(ids, dt)`, `updateKeyframe`, `removeKeyframes`, `setEasingForTrack`, `clearTrack`, `setTimelineUi`,
  `toggleExpanded`, `orderedLayers(bundle)` (helper exporté).
- Unités : positions en px CSS (1 px = 1 unité monde), rotations en **degrés** (convertir en radians côté rendu),
  `scale`/`opacity`/intensités en **pourcents** (100 = 1). `camera.orbitX/orbitY/roll` en degrés.
  `aperture` 0..10 est une valeur UI : mapper vers BokehPass `aperture = ui * 0.00001`, `maxBlur` UI 0..5 → `ui * 0.01`.
- Les anciens fichiers `engine/timeline.ts` et les anciens champs du store (`layerSettings`, `setLayer`, `dof*`,
  `focusedLayerId`, `tab`) **n'existent plus**.

## Design (voir aussi `PRODUCT.md`, `DESIGN.md` à la racine)

Registre produit, sombre graphite tiède, accent ambre unique (`--accent: oklch(0.80 0.16 70)`), playhead
`oklch(0.70 0.20 30)`. Tokens CSS complets dans `DESIGN.md` ; ils vivent dans `src/studio/styles/tokens.css`
(:root). Interdits : dégradés de texte, glassmorphism, bordures latérales colorées, cartes imbriquées, tirets cadratins
dans les textes UI. Textes UI en français. Icônes `lucide-react` uniquement. Transitions 120-180 ms, ease-out-quart,
jamais sur des propriétés de layout. Numériques en `font-variant-numeric: tabular-nums`.

Layout cible (mock : plateau sombre, chrome qui s'efface) :

```
┌ Topbar 44px : logo · titre page source · [Sélection|Orbite] · [Vue à plat|Perspective|Recadrer] · Modifier la sélection · Export ┐
├ LayerList 240px │ Viewport (flex) │ Inspector 300px ┤
├ Timeline (hauteur = timelineUi.height, redimensionnable par une poignée en haut) ┤
```

Classes CSS : chaque zone possède sa feuille (`styles/shell.css`, `styles/inspector.css`, `styles/viewport.css`,
`styles/timeline.css`) importée par son composant ; `styles/studio.css` ne garde que reset + tokens import + shell.

## Interactions viewport

- Outil **Sélection** (défaut) : clic sur une couche = `select([id])`, Maj+clic = toggle, clic dans le vide = vide la
  sélection. Drag sur une couche sélectionnée = translation dans le plan XY de la couche (met à jour `x`/`y`),
  Alt+drag = translation Z, snapping aux bords/centres des autres couches (seuil 6 px écran) avec guides ambre pointillés.
  Survol = contour fin ambre à 50 %. Contour de sélection 1.5 px ambre + 8 poignées carrées 7 px (coins = scale
  uniforme, milieux = distort du côté).
- Cmd/Ctrl+drag (ou outil **Orbite**, ou bouton milieu) = orbite caméra. Molette = dolly (distance), Maj+molette =
  pan vertical, trackpad pinch = dolly. Espace = play/pause. Suppr = retire la couche sélectionnée. Échap = désélection.
- La caméra vit dans le store (`camera`), OrbitControls ne sont plus utilisés : le viewport écrit
  `setCameraValues` à chaque geste, le renderer ne fait que `applyCamera(values)`.

## Moteur

`DioramaRenderer` (engine/renderer.ts) expose :
- `buildLayers(bundle, built, layers)`, `applyCamera(values: CameraValues)`, `applyLayers(values: Record<id, LayerValues>, flags)`
  (position = base + x/y/z, rotation Euler XYZ en radians, scale uniforme autour du pivot `anchorX/Y`, distort = déplacement
  des 4 sommets du `PlaneGeometry` de la couche via ses attributs de position, opacité), `applyScene(values: SceneValues, settings)`
  (DirectionalLight + AmbientLight, shadow map PCFSoft, `castShadow`/`receiveShadow` par couche ; quand `lightEnabled` est
  faux on utilise `MeshBasicMaterial`, sinon `MeshLambertMaterial` avec la texture en `map` et `emissive` blanc atténué pour
  garder la page lisible), `setDof`, `pick(ndcX, ndcY): string|null` (raycast), `layerScreenQuad(id, w, h): {x,y}[4] | null`
  (projection des 4 coins pour le contour de sélection), `layerWorldRect(id)`, `fitCamera/fitLayer/fitAll` retournant des
  `CameraValues`, `renderFrame()`, `resize`, `setExportSize`, `setFrameAspect`, `dispose`.
- Le fond (`role: 'background'`) reste un plan géant coloré, `receiveShadow: true`, jamais `castShadow`.

## Validation

`npm run typecheck` puis `npm run build` doivent passer. Ne pas lancer de serveur.
