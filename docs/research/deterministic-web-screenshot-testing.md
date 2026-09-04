# Stratégie de snapshots pixel-perfect pour Diorama

> Décision technique fondée sur l’audit du pipeline actuel, un test réel sous Chromium 152 et la documentation primaire des outils évalués.

## Verdict

Il faut séparer deux problèmes qui ont été mélangés jusqu’ici :

1. **Déterminisme** : deux captures du même état produisent-elles exactement les mêmes octets ?
2. **Fidélité** : la reconstruction produit-elle les mêmes pixels que la page source ?

Une bibliothèque de diff ne peut corriger que la mesure. Elle ne peut pas rendre fidèle une capture qui ne l’est pas.

Pour Diorama, aucune bibliothèque de clonage DOM ne peut garantir un rendu 1:1 avec le compositeur Chromium. La seule source de vérité pixel-perfect est un raster produit par **le même compositeur du même onglet**, via Page.captureScreenshot (Chrome DevTools Protocol) ou, avec moins de contrôle, chrome.tabs.captureVisibleTab().

La recommandation est donc :

- **court terme** : rendre le pipeline actuel déterministe et le mesurer correctement ;
- **cible** : utiliser un pipeline hybride « native raster first » pour les textures finales, et conserver le DOM sérialisé comme métadonnée/fallback, pas comme source de vérité visuelle ;
- **tests** : Playwright pour orchestrer et stabiliser les scénarios, Pixelmatch ou odiff pour expliquer les écarts — pas pour capturer.

## Mesure réalisée sur le pipeline actuel

Environnement : Chrome 152.0.7977.64, macOS, viewport 2554×1373, DPR 1, page Wikipedia ouverte dans le même navigateur que le Studio.

Protocole :

- cinq Page.captureScreenshot consécutifs de la page source ;
- cinq captures HTML-in-Canvas consécutives du clone déjà reconstruit ;
- comparaison RGBA sans redimensionnement.

Résultats :

| Mesure | Résultat |
|---|---:|
| Hashes source distincts sur 5 captures | **1** |
| Hashes clone distincts sur 5 captures | **1** |
| Pixels source/clone avec au moins 1 canal différent | **985 392 / 3 507 242 (28,10 %)** |
| Pixels source/clone avec delta > 8 | **88 595 (2,526 %)** |
| Delta absolu moyen par canal | **2,383865** |
| Delta maximal | **255** |

Conclusion : dans ce cas, le raster est parfaitement stable une fois l’état posé. Le problème observé n’est pas un bruit aléatoire du PNG ou de l’outil de diff : c’est surtout une **divergence systématique de reconstruction**. Les variations aléatoires restantes peuvent venir des barrières incomplètes de chargement (polices/images), des animations et d’un DOM qui continue à muter pendant la sérialisation.

## Spike SnapDOM

@zumer/snapdom 2.24.15 a été testé dans le même onglet et avec le même viewport, avec DPR 1, fast false, reconcile true, embedFonts true, outerShadows true, compression et cache désactivés.

Résultats contre le screenshot natif :

| Mesure | Pipeline Diorama | SnapDOM |
|---|---:|---:|
| Pixels différents | 28,10 % | **48,53 %** |
| Pixels avec delta > 8 | 2,526 % | **30,22 %** |
| Delta moyen par canal | 2,38 | **9,71** |

SnapDOM est une bibliothèque sérieuse et bien plus complète qu’un cloneur maison : chargement de fontes, pseudo-éléments, shadow DOM, réconciliation de layout, ombres externes, cache, export SVG/PNG. Mais elle utilise elle aussi un clone DOM rendu dans un SVG foreignObject. Sur la fixture réelle testée, elle n’est donc **pas** un remplacement plug-and-play pixel-perfect pour Diorama.

html2canvas documente explicitement la même limite : il ne prend pas un vrai screenshot ; il reconstruit l’image à partir des informations de la page et « may not be 100% accurate ».

## Architecture recommandée

### A. Capture native comme oracle et source de texture

Flux cible :

~~~text
onglet source stabilisé
        │
        ├── screenshot natif complet ───────────────► oracle / preview 1:1
        │
        ├── éléments zappés masqués (layout conservé)
        │        └── screenshot natif ──────────────► texture background sans trous
        │
        └── passe d’isolation par élément
                 └── screenshot(s) natif(s) ────────► textures de layers
~~~

Deux voies d’accès existent :

1. **chrome.debugger + CDP Page.captureScreenshot**
   - contrôle du clip, du format et du viewport ;
   - pas de limite documentée à deux appels/seconde ;
   - nécessite la permission debugger et l’attachement temporaire à l’onglet ;
   - c’est le meilleur chemin pour un outil dev-first non distribué sur le Store.

2. **chrome.tabs.captureVisibleTab()**
   - API d’extension plus simple ;
   - limitée au viewport visible ;
   - Chrome documente une fréquence maximale de deux appels par seconde ;
   - moins adaptée à une passe par layer.

Le screenshot natif complet est trivialement 1:1 avec la page puisqu’il est la page. La difficulté réelle est l’extraction d’un layer transparent. Pour un MVP robuste :

- conserver la géométrie issue de getBoundingClientRect() ;
- masquer tous les autres éléments avec visibility (pas display:none) pour ne pas provoquer de reflow ;
- capturer sur fond transparent si CDP/Chromium le permet dans le contexte ciblé ;
- sinon faire deux passes de matte noir/blanc et reconstruire l’alpha ;
- recadrer sur des bornes physiques alignées au DPR, avec marge pour ombres, outline et filter ;
- garder une texture plein viewport lorsque les modes de fusion ou backdrop-filter rendent le crop ambigu.

### B. DOM sérialisé comme fallback, pas comme oracle

Le bundle DOM reste utile pour conserver la sémantique et les sélecteurs, reconstruire un projet hors ligne, fournir un fallback quand CDP est indisponible, et aider au calcul des layers.

Mais il ne faut plus demander à ce clone d’être le raster de référence. Chaque correction CSS ponctuelle repousse seulement la prochaine divergence : formulaires natifs, SVG avec références internes, polices cross-origin, pseudo-éléments, shadow DOM, canvas, vidéos, filtres, blending, scrollbars, contrôles UA, etc.

### C. Comparaison visuelle

Pour les tests automatisés :

- utiliser expect(page).toHaveScreenshot() de Playwright ;
- générer et vérifier les baselines dans le **même environnement** (même version de Chromium, OS/container, fontes et DPR) ;
- attendre document.fonts.ready et img.decode() ;
- désactiver animations et curseur/caret ;
- figer horloge, données réseau et aléatoire ;
- distinguer :
  - **stabilité** : SHA-256 strict sur N captures du même état ;
  - **fidélité plate** : native source vs native texture/composition, même taille et même DPR ;
  - **qualité 3D** : test séparé, perceptuel, car la projection et le filtrage WebGL ne sont pas un raster DOM identique.

Playwright documente qu’il attend deux screenshots consécutifs identiques avant de retenir le résultat. Il avertit aussi que le rendu varie selon l’OS, la version du navigateur, les réglages, le matériel, le mode headless et même l’alimentation : les baselines doivent donc être générées dans le même environnement que les tests.

Pixelmatch est adapté à l’explication des écarts : seuil perceptuel, détection des pixels anti-aliasés et métrique de densité locale. Un seuil ne doit jamais servir à masquer un décalage géométrique ; les deltas d’alignement, de dimension et de bounding boxes doivent être testés séparément avant la comparaison perceptuelle.

## Causes concrètes identifiées dans Diorama

1. sceneBuilder.ts ne bloquait pas sur document.fonts.ready ni img.decode() avant la première capture.
2. serialize.ts réémettait des propriétés héritées identiques sur chaque descendant. Cela gonflait la CSS et cassait l’isolation par visibility.
3. La suppression globale des attributs id cassait les paint servers et références internes SVG.
4. La sérialisation est asynchrone alors que la page reste vivante : le DOM peut changer entre deux nœuds.
5. Les rectangles flottants sont recadrés dans des canvas aux tailles entières, ce qui introduit un rééchantillonnage.
6. La texture de capture est actuellement allouée en pixels CSS sans stratégie DPR explicite.
7. Le test historique compare en partie un rendu DOM 2D à une projection WebGL, ce qui mélange fidélité de capture et qualité de projection.

Les trois premiers points ont été corrigés dans le code à l’issue de cet audit. Les points 4 à 7 demandent le nouveau harnais puis le spike CDP avant migration.

## Plan de migration proposé

### Étape 1 — verrouiller la mesure

- fixture locale hermétique couvrant fonte, image, SVG avec use/gradient/mask, ombre, pseudo-élément, canvas et contrôles natifs ;
- runner N=10 : hash source, hash bundle, hash clone, métriques géométriques, Pixelmatch ;
- artifacts : expected, actual, diff, JSON de métriques ;
- zéro sleep() arbitraire : uniquement des barrières d’événements.

### Étape 2 — spike CDP sur trois pages réelles

Comparer sur Wikipedia, Tactill et une landing app moderne : clone HTML-in-Canvas actuel contre screenshot natif et isolation/matte. Mesurer temps de capture, mémoire bundle, fidélité plate, ombres et transparence.

Critères :

- 10/10 hashes identiques pour chaque état figé ;
- 0 pixel différent pour le screenshot natif complet ;
- géométrie des layers exacte à ±0,01 px CSS ;
- seuil perceptuel défini séparément pour l’isolation alpha et pour le rendu WebGL.

#### Résultats du spike CDP (Chromium 152, DPR 1, 2554 px de large)

Le premier incrément hybride est implémenté avec chrome.debugger + Page.captureScreenshot : oracle plein document, background avec les layers masqués par visibility, passes transparentes isolées avec une marge de 48 px, restauration en finally et fallback vers le clone. Les PNG sont stockés dans le bundle et chargés directement par le Studio quand toutes les passes sont disponibles.

| Page / layer | Document | Pixels différents après recomposition | Delta > 8 | Delta moyen/canal | Max |
|---|---:|---:|---:|---:|---:|
| Wikipedia / logo central | 2554 × 1373 | 1 865 (0,05318 %) | 0 (0 %) | 0,000522 | 5 |
| Tactill / H1 hero, échantillon 1000 × 2613 | 2554 × 6673 | 6 079 (0,23264 %) | 1 420 (0,05434 %) | 0,008579 | 57 |

La baseline clone Wikipedia mesurée sur la même classe de page était de 3,20640 % des pixels avec delta > 8 et un delta moyen de 2,13967. La voie native descend donc le delta significatif à 0 % sur Wikipedia et 0,05434 % sur Tactill. Les résidus viennent surtout de la recomposition alpha/anti-aliasing et, sur Tactill, de contenu animé entre les passes ; l'oracle lui-même reste le raster natif exact.

Limites du spike : la sérialisation clone précède encore les passes CDP et reste coûteuse ; l'ordre des layers isolés suit encore l'ordre Diorama plutôt qu'un ordre de stacking calculé ; backdrop-filter et mix-blend-mode exigent une stratégie plein viewport ou matte dédiée.

#### Validation sur pages réelles et corrections (3 septembre 2026)

Le flow global (sélection → cover tab → passes CDP → Studio) est validé sur Vinted et Wikipedia. Deux défauts de fidélité ont été identifiés sur Vinted et corrigés :

1. **Couches imbriquées.** Quand un élément sélectionné est descendant d'un autre élément sélectionné (bouton « Commencer à vendre » dans l'encart hero), la passe d'isolation du parent rendait aussi l'enfant : la règle `[data-diorama-raster-target] * {visibility:visible}` couvrait tout le sous-arbre. L'enfant apparaissait donc deux fois dans la scène (figé dans le parent, et sur sa propre couche). Correction dans `src/background/cdpRaster.ts` : les couches sélectionnées descendantes de la cible reçoivent `data-diorama-raster-excluded` et une règle plus spécifique les remet en `visibility:hidden`. Le fallback HTML-in-Canvas avait déjà ce comportement (les autres couches reçoivent `visibility:hidden` inline, hérité par leur sous-arbre).

2. **Boîte visuelle du parent.** Le clic sur l'encart hero tombait sur `div.u-ui-padding-x2-large` (aucun fond), alors que le fond blanc arrondi est porté par son parent `div.…temp-banner` de bounding box identique. La couche isolée n'avait donc pas de fond. Correction dans `src/content/cluster.ts` (`promoteToVisualBox`) : avant la recherche d'unité répétée, `resolveTarget` remonte vers l'ancêtre de même boîte (±2 px, sans autre enfant visible) qui peint réellement quelque chose (background, bordure, ombre ou outline). Sans ancêtre peint, l'élément d'origine est conservé.

Ces deux corrections ne s'appliquent qu'à la sélection et aux passes d'isolation ; l'oracle et le fond restent inchangés.

### Étape 3 — migration hybride

- ~~ajouter les textures raster natives au CaptureBundle~~ — fait (`bundle.raster`, champs tous optionnels, `CaptureRaster` dans `src/shared/types.ts`) ;
- ~~charger ces textures directement dans Three.js~~ — fait (`buildNativeScene` dans `src/studio/engine/sceneBuilder.ts`) ;
- ~~conserver le clone pour inspection/fallback~~ — fait (`hasCompleteNativeRaster` décide du chemin) ;
- versionner le bundle et prévoir une migration v1 vers v2 — non fait : le raster est un enrichissement optionnel d'un bundle v1, ce qui rend la migration inutile tant que le clone reste embarqué.

## Sources primaires

- Playwright, Visual comparisons: <https://playwright.dev/docs/test-snapshots>
- Playwright, toHaveScreenshot options: <https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1>
- Chrome DevTools Protocol, Page.captureScreenshot: <https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot>
- Chrome Extensions, chrome.debugger: <https://developer.chrome.com/docs/extensions/reference/api/debugger>
- Chrome Extensions, tabs.captureVisibleTab: <https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab>
- Pixelmatch README: <https://github.com/mapbox/pixelmatch>
- SnapDOM README et limites: <https://github.com/zumerlab/snapdom>
- html2canvas README: <https://github.com/niklasvh/html2canvas>
- HTML-in-Canvas explainer: <https://github.com/WICG/html-in-canvas>
