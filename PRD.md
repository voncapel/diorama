# PRD — Diorama

> Extension Chrome (dev-first) transformant une page web vivante en scène 3D animée,
> via l'API native **HTML-in-Canvas** (`WICG/html-in-canvas`), pour produire des vidéos
> marketing 4K avec caméra, profondeur de champ et motion blur.

- **Codename** : `Diorama` *(provisoire — à valider)*
- **Date** : 2 septembre 2026
- **Statut** : Le studio en onglet dédié (`studio.html`) et son export 4K ont été
  validés selon les mesures du 3 septembre 2026. L'approche overlay in-situ a été
  abandonnée (elle masquait les bords de page et dégradait l'UX) au profit de
  l'encapsulation complète de la page dans le Viewport du Studio dédié, redimensionnée
  à l'échelle ("resized down / fit") avec marge de respiration, garantissant 100 % de visibilité
  sans obstruction. Voir §6–7 et §9.
  Deux hypothèses du PRD sont **invalidées par la mesure** : le layering par `drawable`
  imbriqué (§4) et le chemin d'upload WebGL2 `texElementSubImage2D` (§5.4).
  **Pivot « native raster first » (3 septembre 2026)** : les textures des couches sont
  désormais produites par le compositeur de l'onglet source lui-même, via
  `Page.captureScreenshot` (Chrome DevTools Protocol) en passes multiples à isolation par
  `visibility` (§4). Le clone HTML-in-Canvas reste embarqué dans le bundle comme
  **fallback** et comme métadonnée, mais n'est plus la source de vérité visuelle
  (cf. `docs/research/deterministic-web-screenshot-testing.md`). Le flow global est
  validé sur pages réelles ; les corrections en cours portent sur la fidélité des
  captures (couches imbriquées, boîte visuelle du parent — §4 et §5.2).
- **Auteur cible** : usage personnel + cercle de devs (pas de distribution Chrome Web Store)

---

## 1. Positionnement et parti pris

### 1.1. Le pari fondateur

Diorama est construit **sans compromis sur HTML-in-Canvas**. L'API
`drawElementImage` / `texElementSubImage2D` / `drawElementImageToTexture` est le socle
du moteur de rendu, et non une optimisation optionnelle.

**Conséquence assumée** : l'outil nécessite Chrome Canary (ou Chromium 147+) avec le flag
`chrome://flags/#canvas-draw-element` activé, et un chargement en extension non
empaquetée (`Load unpacked`). Il n'y aura **pas** de chemin de repli `foreignObject`/SVG.

### 1.2. Ce que ce choix élimine

| Contrainte levée | Impact |
| :--- | :--- |
| Double implémentation `LayerSource` | ~40 % de complexité moteur en moins |
| Compatibilité navigateurs | Une seule cible de rendu à tester |
| Review Chrome Web Store | Permissions larges (`<all_urls>`) acceptables |
| Dégradation gracieuse UX | Un seul niveau de qualité : le maximum |

### 1.3. Ce que ce choix n'élimine pas

Trois contraintes sont **intrinsèques à la spécification**, pas au mode de distribution.
Elles restent entièrement à traiter (cf. §3).

1. Un élément dessinable doit être **descendant** d'un `<canvas layoutsubtree>`.
2. Le contenu **cross-origin n'est pas peint** (read-back-allowed rendering).
3. La résolution des textures 3D est **fixe** au moment de l'upload.

---

## 2. Utilisateurs et cas d'usage

### 2.1. Profil unique (P0)

**Le dev-designer produit.** Travaille sur Mac Apple Silicon (M2 Pro+), à l'aise avec
Chrome Canary et les flags, exigeant sur la qualité visuelle, produit des vidéos de
lancement / démos produit / posts sociaux à partir de ses propres landing pages.

Il n'a **pas** besoin d'être guidé, il a besoin de **ne pas être bridé**.

### 2.2. Cas d'usage prioritaires

| # | Scénario | Priorité |
| :--- | :--- | :--- |
| U1 | Sélectionner en 1 clic les 3 cartes de pricing d'une page, les faire entrer en cascade décalée avec une caméra qui recule | **P0** |
| U2 | Décoller un élément du fond en Z, avec le fond qui passe en flou de profondeur de champ | **P0** |
| U3 | Décrire un mouvement en langage naturel et obtenir une timeline éditable | **P1** |
| U4 | Exporter en 4K 60 fps, déterministe, sans frame drop | **P0** |
| U5 | Rejouer/éditer un projet sauvegardé sans avoir la page d'origine ouverte | **P1** |
| U6 | Animer du texte lettre par lettre en conservant la police et le kerning réels | **P2** |

### 2.3. Non-objectifs explicites

- Pas d'édition audio, pas de montage multi-séquences.
- Pas de capture de pages nécessitant une authentification complexe en Phase 1.
- Pas de rendu d'interactions live (formulaires cliquables dans la vidéo) — hors périmètre
  malgré le support natif de la spec.
- Pas de collaboration temps réel.

---

## 3. Contraintes techniques fondatrices

Ces quatre vérités sont issues de la lecture de l'explainer et des issues du WICG.
Toute l'architecture en découle.

### C1 — L'élément doit vivre dans le canvas

> *« Elements can't be rendered without being attached to the document object model. »*
> — `progers`, [WICG/html-in-canvas#57](https://github.com/WICG/html-in-canvas/issues/57)

`drawElementImage()` lève une exception si l'élément n'a pas l'attribut `drawable` et
n'est pas descendant du `<canvas layoutsubtree>`. **On ne peut donc pas dessiner
directement un élément d'un site tiers.**

→ **Réponse architecturale** : le pipeline de *capture* (§5.1) clone le sous-arbre cible,
inline ses styles et ses assets, puis le remonte dans le canvas du studio.
On évite la **rasterisation**, pas la **réintégration**.

### C2 — Le cross-origin n'est pas peint

La spec fonctionne en **read-back-allowed rendering** : le readback pixel est autorisé
(pas de canvas *tainted*), en échange de quoi le contenu sensible est **omis du rendu**.

Sont exclus du painting : `<img>` et `<iframe>` cross-origin, les `url()` cross-origin
(`background-image`, `clip-path`, `mask-image`), SVG `<use>`, l'antialiasing sous-pixel,
les couleurs système, les marqueurs d'orthographe, les liens visités.

→ **C'est le risque n°1 du produit** : une landing page servie par un CDN tiers rendrait
en trous. **Réponse** : l'étape de capture fetch tous les assets via le service worker
(qui dispose des host permissions et n'est pas soumis au CORS de la page) et les
ré-inline en `data:` URI. Un `data:` URI n'est pas cross-origin → il doit peindre.
**Validé en Phase 0 (V2)** : les `data:` URI sont bien peints.

### C3 — La résolution des textures est figée à l'upload

Le snapshot est une *display list* (commandes de rendu), pas un bitmap : en 2D,
`drawElementImage` rasterise donc **net** à n'importe quelle échelle. Mais le chemin 3D
(`texElementSubImage2D` / `drawElementImageToTexture`) écrit dans une texture de
dimensions **fixes**.

→ Une caméra qui pousse à 300 % sur du texte donnera du flou.
**Réponse** : politique de DPR adaptatif piloté par la distance caméra (§5.4).

### C4 — Le `paint` est arrimé au cycle de rendu du navigateur

L'événement `paint` se déclenche dans *update-the-rendering*, après les étapes
d'IntersectionObserver. On ne peut pas le cadencer arbitrairement.

→ **Réponse** : le clone capturé est **inerte** (aucun JS ne tourne dedans), donc les
snapshots de couches sont **statiques**. L'export ne dépend plus du `paint` (§5.6).

---

## 4. L'insight architectural central : le layering natif

C'est le point qui rend le projet supérieur à toute approche par screenshot.

L'explainer précise :

> *« `drawable` elements can be nested, and a drawable subtree includes a drawable element
> and its descendants, **excluding `drawable` descendants and their subtrees**. »*

**Traduction pour Diorama** : si on marque la racine de la page `drawable`, **et** chaque
élément « zappé » `drawable`, alors le snapshot de la racine **exclut automatiquement**
les éléments zappés.

```
<canvas layoutsubtree>
  <div drawable id="page-root">        → snapshot SANS les cartes
    …
    <div drawable id="card-1">…</div>  → snapshot isolé
    <div drawable id="card-2">…</div>  → snapshot isolé
    <div drawable id="card-3">…</div>  → snapshot isolé
  </div>
</canvas>
```

Conséquence : **décoller un élément en Z ne laisse aucun trou dans le fond.** Le
navigateur relayoute et repeint le fond sans l'élément, gratuitement, au pixel près, avec
les vraies ombres et le vrai `backdrop-filter`.

C'est impossible avec `tabCapture` (flux composé et plat) et coûteux avec un screenshot
(il faudrait inpainter). C'est ici que le pari html-in-canvas se justifie pleinement.

### 4.1. Ce qui a été mesuré, et ce qui est implémenté

**L'hypothèse ci-dessus est invalidée par la mesure** (Chromium 152, cf. §6 Phase 0) : un
`drawable` imbriqué n'est *pas* exclu du snapshot de son parent. L'insight reste valable
dans son principe — **isoler chaque couche sans relayout** — mais le mécanisme retenu
est différent : l'isolation se fait par **cascade de `visibility`**, qui masque un
sous-arbre sans toucher au layout (contrairement à `display:none`), donc sans déplacer
les voisins ni fermer les trous. Le fond « sans l'élément » est bien obtenu, avec les
ombres et le `backdrop-filter` réels, puisque c'est le compositeur qui repeint.

Ce mécanisme est appliqué par le **pipeline natif** (`src/background/cdpRaster.ts`), qui
tourne dans le service worker, attaché à l'onglet source par `chrome.debugger` :

| Passe | Mutation injectée (feuille `<style>` + attributs, restaurés ensuite) | Sortie |
| :--- | :--- | :--- |
| `oracle` | Aucune (seul l'overlay Diorama est masqué) | `oraclePng` — page complète, référence visuelle |
| `background` | `visibility:hidden` sur chaque élément sélectionné | `backgroundPng` — fond sans les couches, sans trou |
| `layer` ×N | `:root * {visibility:hidden}` puis `visibility:visible` sur la cible et ses descendants ; fond de page transparent (`Emulation.setDefaultBackgroundColorOverride`) | un PNG RGBA par couche, découpé sur `sourceRect` (rect + marge de 48 px pour les ombres et débords) |

Pendant les passes, l'onglet source est recouvert par un onglet `loading.html` de
l'extension : un voile *dans* la page entrerait dans les screenshots.

**Couches imbriquées.** Quand une couche sélectionnée est descendante d'une autre couche
sélectionnée (ex. un bouton dans une carte), la passe `layer` du parent **exclut** le
sous-élément (`data-diorama-raster-excluded` → `visibility:hidden`, règle plus spécifique
que celle qui rend le parent visible). Chaque pixel de la page n'appartient ainsi qu'à une
seule couche ; le parent ne montre pas une copie figée de l'enfant qui, lui, bouge en Z.

Le **fallback HTML-in-Canvas** (`src/studio/engine/sceneBuilder.ts`) applique exactement
la même isolation par `visibility` sur le clone reconstruit dans `<canvas layoutsubtree>`,
lorsque le raster natif est absent ou incomplet (`raster.error`, couche en erreur).

---

## 5. Architecture système

```
┌─ PHASE CAPTURE (content script, sur la page cible) ──────────────┐
│  Zap Engine        → clustering DOM, sélection multiple           │
│  Serializer        → clone + inline styles + inline fonts         │
│  Asset Resolver    → fetch cross-origin via SW → data: URI        │
│                    ↓ CaptureBundle (JSON autonome, clone)         │
└───────────────────────────────────────────────────────────────────┘
                     ↓
┌─ PHASE RASTER NATIF (service worker, chrome.debugger sur l'onglet)┐
│  Cover tab         → loading.html recouvre la page pendant les    │
│                      passes                                       │
│  CDP Raster        → Page.captureScreenshot ×(2 + N) : oracle,    │
│                      fond, une passe isolée par couche (§4.1)     │
│                    ↓ bundle.raster (PNG par couche + fond)        │
└───────────────────────────────────────────────────────────────────┘
                     ↓
┌─ PHASE STUDIO (onglet extension dédié) ──────────────────────────┐
│  Scene Builder     → raster natif complet ? textures = PNG        │
│                      sinon fallback : DOM dans <canvas            │
│                      layoutsubtree> + isolation par visibility    │
│  Layer Graph       → 1 élément zappé = 1 texture = 1 mesh 3D      │
│  Renderer (WebGL2) → canvas scratch → CanvasTexture → Three.js    │
│  Camera Rig        → 6-DoF, DoF bokeh, motion blur vélocité       │
│  Timeline          → keyframes, easing, stagger                   │
│  AI Director       → prompt → assemblage de presets → timeline    │
└───────────────────────────────────────────────────────────────────┘
                     ↓
┌─ PHASE EXPORT (offline, découplé du paint) ──────────────────────┐
│  Virtual Clock     → t = frame / fps, aucune dépendance rAF       │
│  VideoEncoder      → WebCodecs h264/hevc hardware Apple Silicon   │
│  Muxer             → mp4-muxer → fichier .mp4 4K 60fps            │
└───────────────────────────────────────────────────────────────────┘
```

### 5.1. Module Capture — `CaptureBundle`

Produit un artefact **autonome et rejouable** (répond à U5).

```jsonc
{
  "version": 1,
  "source": { "url": "...", "title": "...", "capturedAt": "..." },
  "viewport": { "width": 1440, "height": 900, "dpr": 2 },
  "html": "<div id=\"page-root\">…</div>",   // clone sérialisé
  "styles": "…",                              // feuille scopée, computed styles résolus
  "assets": { "sha256:abc…": "data:image/webp;base64,…" },
  "fonts":  [{ "family": "Inter", "weight": 600, "src": "data:font/woff2;base64,…" }],
  "layers": [
    { "id": "L0", "role": "background", "selector": "[data-diorama-root=\"1\"]",
      "stableId": "background" },
    { "id": "L1", "role": "zap", "clusterId": "C1", "selector": "[data-diorama-layer=\"L1\"]",
      "stableId": "42",                         // data-dio-id sur l'élément vivant
      "rect": { "x": 120, "y": 340, "w": 320, "h": 480 } }
  ],
  "clusters": [{ "id": "C1", "score": 0.94, "memberIds": ["L1","L2","L3"] }],
  "selection": { "selectors": ["[data-dio-id=\"42\"]"] },   // re-seed du picker
  "raster": {                                   // enrichissement natif (§4.1), optionnel
    "method": "cdp-page-capture-screenshot",
    "document": { "width": 1440, "height": 5200 },
    "oraclePng": "data:image/png;base64,…",
    "backgroundPng": "data:image/png;base64,…",
    "layers": [{ "layerId": "L1", "sourceRect": { "x": 72, "y": 292, "w": 416, "h": 576 },
                 "png": "data:image/png;base64,…" }]
  }
}
```

Le bloc `raster` est produit après le clone, dans le service worker, et stocké avec lui
dans `chrome.storage.local`. Tous ses champs sont optionnels : un bundle sans raster, ou
avec une couche en `error`, reste valide et déclenche le fallback HTML-in-Canvas
(`hasCompleteNativeRaster()`). Si ni raster complet ni API HTML-in-Canvas ne sont
disponibles, le Studio affiche une erreur explicite.

**Points d'attention d'implémentation :**
- Les `<canvas>` et `<video>` de la page source sont figés en `data:` URI à la capture.
- Les pseudo-éléments (`::before`/`::after`) doivent être conservés via la feuille scopée,
  pas via l'inline `style` (qui ne les porte pas).
- Les Shadow DOM ouverts sont aplatis ; les Shadow DOM fermés sont un échec connu accepté.
- Le scroll : on capture la **page complète** (hauteur `scrollHeight`), pas seulement le
  viewport — c'est ce qui permet les mouvements de caméra verticaux.

### 5.2. Module Zap — clustering DOM

L'algorithme de sélection multiple automatique. Zéro risque technique, valeur perçue
maximale.

**Signature d'un élément** :
```
sig(el) = {
  tagPath      : chaîne des tags ancêtres sur 3 niveaux      (poids 0.30)
  classTokens  : tokens de classe normalisés (hash CSS-in-JS
                 et suffixes numériques strippés)             (poids 0.30)
  geometry     : (w, h) bucketisés à ±8 %                     (poids 0.25)
  childShape   : nombre + types des enfants directs           (poids 0.15)
}
```

**Score de similarité** = somme pondérée (Jaccard sur `classTokens`, égalité sur
`tagPath`, distance relative sur `geometry`, Jaccard sur `childShape`).

**Résolution de la cible** (`resolveTarget`, `src/content/cluster.ts`) — l'élément sous
le curseur est presque toujours le plus profond (un `<span>` de label, un `<div>` de
padding), jamais l'unité visuelle. Deux promotions successives :

1. **Boîte visuelle** (`promoteToVisualBox`) : tant que l'élément ne peint rien lui-même
   (pas de `background`, de bordure, d'ombre ni d'outline) et que son parent a la même
   bounding box (±2 px) sans autre enfant visible, on remonte. On ne s'arrête que sur un
   ancêtre qui peint réellement ; sinon on garde l'élément d'origine. C'est ce qui fait
   qu'un clic dans l'encart blanc d'un hero (Vinted : `div.u-ui-padding-x2-large` →
   `div.temp-banner` qui porte `background:#fff;border-radius:12px`) capture la carte
   *avec* son fond, et non son seul contenu.
2. **Unité répétée** : on parcourt ensuite toute la chaîne d'ancêtres (≤ 12 niveaux,
   < 40 % du viewport) et on garde le plus grand qui possède des frères similaires
   (score ≥ seuil). Cela gère `li > ul > .card` où le conteneur intermédiaire est unique.

**Règles produit** :
- Seuil par défaut `0.72`, exposé dans un slider « largeur du Zap ».
- On ne clusterise **que parmi les frères/sœurs du même parent** en premier passage,
  puis on élargit à la page entière en second passage (évite les faux positifs massifs).
- Feedback visuel : survol → l'élément visé en plein, les membres du cluster en fantôme
  pointillé, compteur `3 éléments similaires`.
- `Shift+clic` ajoute/retire un membre manuellement ; l'édition manuelle gèle le cluster.
- **Ordre de stagger** dérivé automatiquement de la position (`x` puis `y`), inversable.

### 5.3. Module Scene Builder & Layer Graph

`buildScene()` choisit le chemin selon le bundle :

**Chemin natif** (`hasCompleteNativeRaster`) — aucun DOM n'est reconstruit. Chaque
couche reçoit le rect de sa capture (`sourceRect`, donc rect + marge) et sa texture est
le PNG décodé, dessiné dans le canvas scratch de la couche. Le fond utilise
`backgroundPng` sur tout le document.

**Chemin fallback HTML-in-Canvas** — reconstruit le clone dans le studio :

1. Injection des `@font-face` inlinés dans le document du studio.
2. Injection de la feuille scopée.
3. Insertion du `html` dans `<canvas layoutsubtree>`, racine seule `drawable`, hôte
   maintenu géométriquement dans le viewport (derrière le Viewport 3D), onglet au
   premier plan — sinon aucun paint record.
4. Attente de `fonts.ready`, décodage des images, puis `requestPaint()` → `paint`.
5. Mesure des rects dans le DOM reconstruit, puis par couche : `captureElementImage(root)`
   avec isolation par `visibility` (fond : couches masquées ; couche : racine masquée,
   cible visible, autres couches masquées) et blit de la région dans le scratch.

Dans les deux cas, chaque layer devient un `THREE.Mesh` (plane) dont :
- la taille monde dérive du rect en unités CSS,
- la position `z` initiale est `1 + order` (fond à `0`), animable,
- la texture est une `CanvasTexture` (sRGB, mipmaps) sur le canvas scratch, avec
  `alphaTest` de 0,02 sur les couches zappées pour que la transparence du PNG écrive
  quand même une profondeur exploitable par le bokeh.

### 5.4. Module Renderer & politique de résolution (réponse à C3)

**Choix technologique** : **WebGL2 + Three.js** en Phase 1.
Justification : `texElementSubImage2D` est le chemin le plus éprouvé, et un PR three.js
existe déjà ([mrdoob/three.js#31233](https://github.com/mrdoob/three.js/pull/31233)).
WebGPU (`drawElementImageToTexture`) est un objectif Phase 3 pour les passes de
post-processing en compute shader.

**Politique de DPR adaptatif** :
```
requiredDPR(layer) = basePixelRatio × cameraZoomFactor(layer) × qualityMultiplier
```
- Recalculée à chaque changement de keyframe caméra, pas à chaque frame.
- Re-upload de la texture lorsque le ratio requis dépasse le ratio courant de +25 %.
- Plafond mémoire : budget global de VRAM configurable (défaut 2 Go), éviction LRU.
- **En export, on pré-calcule le DPR max atteint par chaque layer sur toute la timeline
  et on uploade une seule fois à cette résolution.** Pas de compromis temps réel.

**Post-processing (ordre de passes)** :
1. G-buffer : couleur + profondeur + vélocité par layer.
2. Depth of Field : bokeh hexagonal, distance de focus animable (rack focus).
3. Motion blur : reconstruction par velocity buffer, `shutterAngle` paramétrable.
4. Grading : exposition, contraste, vignette légère, grain optionnel.

### 5.5. Module AI Director

**Anti-pattern rejeté** : demander au LLM de générer des courbes de Bézier libres.
Résultat mou et générique.

**Approche retenue** : bibliothèque de **presets de mouvement paramétrés**, que le LLM
**assemble et règle**. On borne le goût au lieu de l'espérer.

Presets initiaux : `dolly-in`, `dolly-out`, `orbit-reveal`, `push-tilt`, `rack-focus`,
`stagger-cascade`, `parallax-drift`, `hero-lift`, `whip-pan`.

**Contrat de sortie (JSON strict)** :
```jsonc
{
  "duration": 6.0,
  "shots": [
    { "at": 0.0, "preset": "dolly-in",
      "params": { "from": 1.0, "to": 0.72, "easing": "expo.out" },
      "target": "L0" },
    { "at": 0.4, "preset": "stagger-cascade",
      "params": { "axis": "y", "distance": 80, "delay": 0.08, "easing": "back.out" },
      "target": "C1" },
    { "at": 1.6, "preset": "rack-focus",
      "params": { "focusFrom": "L0", "focusTo": "L1", "aperture": 2.8 } }
  ]
}
```

- Endpoint OpenAI-compatible configurable (URL + clé), stocké en `chrome.storage.local`.
- Le contexte envoyé au modèle est **textuel** : liste des layers avec leur rôle, leur
  texte, leur géométrie et leurs clusters. **Aucun pixel n'est envoyé** en Phase 1.
- La sortie est validée contre un JSON Schema ; tout preset inconnu est rejeté et relancé.
- **Toute timeline générée est éditable à la main.** L'IA propose, elle ne verrouille pas.

### 5.6. Module Export — déterminisme (réponse à C4)

Le clone capturé étant **inerte**, les snapshots de layers sont statiques. On les capture
une fois, puis la boucle d'export est **purement WebGL** et ne dépend plus du `paint`.

```
for (frame = 0; frame < totalFrames; frame++) {
  t = frame / fps;                     // horloge virtuelle, aucun rAF
  applyTimeline(t);                    // caméra + transforms de layers
  renderer.render();
  encoder.encode(new VideoFrame(canvas, { timestamp: t * 1e6 }));
  if (frame % 30 === 0) await encoder.flush();   // contre-pression
}
```

- **Cas particulier** : si un layer doit conserver une animation CSS vivante, on pilote
  `document.getAnimations()` en fixant `animation.currentTime = t * 1000`, puis
  `canvas.requestPaint()` et on attend le `paint` avant d'encoder. Chemin lent, opt-in
  par layer, hors Phase 1.
- Codec : `avc1` / `hvc1` en accélération matérielle Apple Silicon ; ProRes envisagé
  en Phase 3.
- Muxing : `mp4-muxer`.
- Sortie de référence : **3840×2160, 60 fps, ~40 Mbps**.

---

## 6. Roadmap

### Phase 0 — Spike de validation (2–3 jours) — **BLOQUANTE**

Les risques sont concentrés ici, pas dans l'UI. Trois questions **binaires**, testées sur
3 vraies landing pages (Stripe, Linear, Vercel) :

| # | Question | Critère de succès |
| :--- | :--- | :--- |
| **V1** | Le clone inline-stylé est-il fidèle à l'original ? | Diff perceptuel < 2 % sur le viewport |
| **V2** | Les assets ré-inlinés en `data:` URI sont-ils **peints** malgré C2 ? | 0 trou visuel sur les 3 pages |
| **V3** | Le layering par `drawable` imbriqué produit-il un fond sans trou ? | Fond correct après retrait d'un layer |
| **V4** | 60 frames consécutives sont-elles **identiques** au pixel près à timeline figée ? | Hash SHA-256 identique sur les 60 |

**V2 est la question qui décide du projet.** Si les `data:` URI ne peignent pas, il faut
basculer sur un pré-traitement en `<canvas>` intermédiaire, voire reconsidérer le socle.

**Livrable** : `work/diorama-spike/` + un rapport go/no-go.

**Verdict (3 septembre 2026) : go.** V1 bon sur la page de test — la fidélité n'a pas été
mesurée perceptuellement sur Stripe / Linear / Vercel. V2 **passe** : les `data:` URI sont
peints. V3 **passe**, mais *pas* par le mécanisme du PRD (voir encadré ci-dessous). V4
**passe** après retrait d'une frame d'amorçage : les frames 2..N sont identiques, la
première diffère.

> **Constat de mesure (Chromium 152).** L'API livrée diffère de l'explainer sur lequel ce
> PRD est bâti. Elle expose `requestPaint()`, `captureElementImage(el)` et
> `ctx.drawElementImage(image, x, y)` — mais **ni** `texElementSubImage2D` **ni**
> `drawElementImageToTexture` : il n'existe aucun chemin d'upload GPU direct, seulement le
> 2D. Contraintes mesurées, qui priment sur §4 et §5.4 : un `drawable` imbriqué n'exclut
> **pas** l'enfant du snapshot parent — le layering passe donc par le **hoisting**,
> c'est-à-dire réattacher le layer en enfant direct du canvas ; `captureElementImage`
> n'accepte que des enfants directs du canvas ; une `ElementImage` n'est dessinable que
> dans le canvas dont elle provient ; `OffscreenCanvas` refuse `drawElementImage` ; le
> canvas hôte doit être géométriquement dans le viewport et l'onglet au premier plan,
> sinon le snapshot est transparent ou lève `No cached paint record for element.`.
>
> Conséquence sur le pipeline : snapshot dans le canvas hôte, puis blit de la région vers
> un canvas *scratch* par layer, consommé par Three.js comme `CanvasTexture`. Les deux
> flags Chromium sont requis : `--enable-blink-features=HTMLInCanvas` **et**
> `--enable-features=CanvasDrawElement`.

### Phase 1 — Le Zap + la scène statique (2 semaines)
- Content script d'inspection + algorithme de clustering (§5.2).
- CaptureBundle complet avec inline d'assets et de polices.
- Studio : textures natives CDP (§4.1), fallback reconstruction + isolation par
  `visibility` (et non `drawable` imbriqué), rendu Three.js.
- Contrôles caméra manuels (orbit / dolly), élévation Z par layer.
- **Jalon démo** : zapper 3 cartes, les décoller en Z, tourner la caméra à la souris.

**Statut : implémentée, flow global validé sur pages réelles (Vinted, Wikipedia) avec le
pipeline natif CDP.** Corrections de fidélité en cours au 3 septembre 2026 :
- couches imbriquées : un sous-élément sélectionné apparaissait aussi dans la texture de
  son parent sélectionné — corrigé par exclusion dans la passe `layer` (§4.1) ;
- boîte visuelle : un clic sur un enfant sans fond capturait la carte sans son fond blanc —
  corrigé par `promoteToVisualBox` (§5.2).

### Phase 2 — Timeline + Export (2 semaines)
- Timeline à keyframes, easings, stagger automatique depuis les clusters.
- Depth of field et motion blur.
- Export WebCodecs 4K 60 fps déterministe.
- **Jalon démo** : un `.mp4` 4K exporté de bout en bout.

**Statut : implémentée et validée sur le studio dédié avec textures HTML-in-Canvas ; à
re-mesurer avec les textures natives CDP (même chemin WebGL en aval).** L'export dédié a été vérifié en 1080p30, 1080p60 et 4K60 (H.264 High, Level 5.2
en 4K — le Level 4.0 plafonne à 1080p et fait échouer la configuration d'encodeur). DoF par
`BokehPass` sur `EffectComposer`, activé à la demande pour laisser le chemin de rendu
direct intact sinon ; le plan de netteté suit le dolly. Motion blur par accumulation de
sous-frames à l'export (shutter 180°, 2/4/8 échantillons), le chemin mono-échantillon
restant strictement inchangé. Déterminisme (A4) confirmé au pixel près : deux exports
consécutifs produisent des flux décodés au hash identique — seules les métadonnées du
conteneur diffèrent, donc les hashes de fichier diffèrent.

### Phase 3 — AI Director + polish (2 semaines)
- Bibliothèque de presets, endpoint LLM, validation de schéma.
- DPR adaptatif complet, budget VRAM.
- Sauvegarde/rechargement de projets.
- Évaluation du portage WebGPU.

---

## 7. Critères d'acceptation produit

| ID | Critère | Seuil |
| :--- | :--- | :--- |
| A1 | Fidélité visuelle de la scène (fond + couches recomposées) vs page réelle (`oraclePng`) | Diff perceptuel < 2 % |
| A2 | Précision du clustering Zap sur 20 pages de test | Précision > 85 %, rappel > 80 % |
| A3 | Fluidité de la préview studio (1440p) | ≥ 50 fps sur M2 Pro |
| A4 | Déterminisme de l'export | 100 % de frames identiques sur re-run |
| A5 | Durée d'export d'un clip de 6 s en 4K 60 fps | < 90 s |
| A6 | Netteté du texte à zoom caméra 300 % | Aucun flou perceptible |

État au 3 septembre 2026 : **A4 et A5 vérifiés uniquement sur l'ancien export dédié**.
Le hash de flux décodé était identique sur deux runs ; 6 s en 4K60 prenaient ~10 s sans
effets et ~24 s avec DoF et motion blur ×4. **A1, A2, A3 et A6 restent non validés**, et
le pipeline natif CDP doit être mesuré (A1 est désormais mesurable directement : `oraclePng`
vs recomposition `backgroundPng` + couches à z = 0) avant toute validation globale. A6 est
structurellement dégradé par le chemin natif : les textures sont des PNG au DPR de l'onglet,
plus une display list vectorielle — à traiter par capture à DPR élevé
(`Emulation.setDeviceMetricsOverride`) en Phase 3.

---

## 8. Risques résiduels

| Risque | Grav. | Prob. | Mitigation |
| :--- | :--- | :--- | :--- |
| ~~Les `data:` URI ne peignent pas (C2)~~ | — | — | **Écarté** : V2 passe, les `data:` URI sont peints |
| L'onglet du studio doit rester au premier plan pour capturer | Moyenne | **Avérée** | Ne concerne plus que le fallback HTML-in-Canvas : le chemin natif fournit des PNG statiques, l'export n'en dépend plus |
| Fidélité du clone insuffisante (CSS complexe, Shadow DOM fermé) | Moyenne | Moyenne | Le clone n'est plus la source de vérité visuelle : raster natif par le compositeur (§4.1), clone en fallback |
| `chrome.debugger` refusé ou page qui réagit à l'attache (bandeau « débogage », scripts anti-devtools) | Moyenne | Faible | Le raster est optionnel : `raster.error` déclenche le fallback ; cover tab pendant les passes |
| Couches qui se chevauchent sans lien de parenté (overlay absolu sur une carte) | Moyenne | Moyenne | Chaque passe `layer` ne rend que la cible ; les pixels recouverts sont dans la couche du dessus, le fond porte le reste |
| Régression de l'API pendant le Developer Trial | Élevée | Moyenne | Pin d'une version Canary ; suivi des issues WICG |
| Coût mémoire des textures haute résolution | Moyenne | Élevée | Budget VRAM + éviction LRU + pré-calcul du DPR d'export |
| Mouvements générés par l'IA génériques | Moyenne | Élevée | Presets bornés + édition manuelle systématique |
| `<video>` en lecture dans la page source | Faible | Moyenne | Figé en poster à la capture (documenté) |

---

## 9. Décisions ouvertes

1. **Nom définitif** du projet (`Diorama` est provisoire).
2. **Studio en onglet dédié ou en side panel ?** **Tranché : onglet dédié (`studio.html`)**.
   L'approche overlay in-situ a été écartée car elle masque les parties critiques de la page
   (headers, sidebars, footers). L'onglet dédié permet d'encapsuler la page dans le Viewport,
   mise à l'échelle pour être visible à 100 % sans aucune obstruction.
3. **WebGPU dès la Phase 2 ?** Dépend de la maturité du `WebGPURenderer` de three.js au
   moment d'attaquer le post-processing.
4. **Modèle LLM par défaut** pour l'AI Director.
5. **Capture multi-états** (hover, page scrollée, modale ouverte) : reporté après Phase 3,
   mais le format `CaptureBundle` doit rester extensible pour l'accueillir.

---

## 10. Références

- [WICG/html-in-canvas — explainer](https://github.com/WICG/html-in-canvas)
- [Issue #57 — Why only elements in a canvas?](https://github.com/WICG/html-in-canvas/issues/57)
- [Issue #81 — Use case: DOM capture library (snapdom)](https://github.com/WICG/html-in-canvas/issues/81)
- [three.js PR #31233 — HTML texture](https://github.com/mrdoob/three.js/pull/31233)
- Flag : `chrome://flags/#canvas-draw-element` (Chrome Canary) — requis pour le fallback uniquement
- [CDP `Page.captureScreenshot`](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot)
- Stratégie raster natif et mesures de déterminisme : `docs/research/deterministic-web-screenshot-testing.md`
- Audit sécurité de l'outil de référence : `projects/webanimate-security-audit.md`
