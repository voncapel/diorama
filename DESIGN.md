# Design

## Theme

Sombre par nécessité, pas par style : l'utilisateur travaille de nuit et le viewport
affiche une page souvent blanche. Le chrome est un graphite tiède (teinte 70, chroma
0.006) qui recule derrière la scène ; l'accent unique est un ambre chaud, réservé à la
sélection, aux keyframes et aux états actifs. La tête de lecture est un rouge-orangé
distinct pour ne jamais être confondue avec une keyframe.

Stratégie couleur : Restrained (neutres teintés + un accent ≤ 10 % de la surface).

## Color

| Token | OKLCH | Usage |
| --- | --- | --- |
| --bg-0 | oklch(0.155 0.006 70) | fond application |
| --bg-1 | oklch(0.195 0.006 70) | panneaux latéraux, timeline |
| --bg-2 | oklch(0.235 0.007 70) | contrôles, lignes de track, champs |
| --bg-3 | oklch(0.28 0.008 70) | hover, segmented actif |
| --void | oklch(0.115 0.005 70) | hors-cadre du viewport |
| --line | oklch(0.30 0.008 70) | séparateurs |
| --line-strong | oklch(0.40 0.01 70) | bordures de champs focus, poignées |
| --ink | oklch(0.93 0.008 80) | texte principal |
| --ink-2 | oklch(0.70 0.01 80) | labels, texte secondaire |
| --ink-3 | oklch(0.52 0.01 80) | unités, ticks, désactivé |
| --accent | oklch(0.80 0.16 70) | sélection, keyframes, actif |
| --accent-soft | oklch(0.80 0.16 70 / 0.18) | fonds sélectionnés |
| --accent-ink | oklch(0.20 0.03 70) | texte sur accent |
| --playhead | oklch(0.70 0.20 30) | tête de lecture |
| --danger | oklch(0.68 0.19 25) | suppression, erreurs |

## Typography

Une seule famille UI : Inter (variable) avec repli système. Numériques en
`ui-monospace, "JetBrains Mono", "SF Mono"` avec `font-variant-numeric: tabular-nums`.

| Rôle | Taille / graisse |
| --- | --- |
| Titre de panneau | 12 px / 600, lettrage 0.02em, capitales |
| Label | 11 px / 500, --ink-2 |
| Valeur | 12 px mono / 500 |
| Corps | 13 px / 400 |
| Nom de couche | 12 px / 500 |

## Spacing & Shape

Base 4 px. Panneaux 12 px de padding, sections 16 px entre elles, rangs de champs 6 px.
Rayons : 4 px contrôles, 6 px items de liste, 10 px popovers. Aucune ombre portée sur les
panneaux (ils sont à plat, séparés par --line) ; ombre uniquement sur les popovers.

## Components

- **NumberField** : champ scrubbable (drag horizontal pour changer, Maj = fin, Alt = gros
  pas), unité à droite en --ink-3, bordure visible seulement au hover/focus.
- **KeyDot** : losange 8 px à gauche d'une propriété. Vide = pas de keyframe ; contour
  accent = canal animé ; plein accent = keyframe sous la tête de lecture.
- **Segmented** : groupe de boutons dans un conteneur --bg-2, l'actif est --bg-3 + --ink.
- **Section** : titre repliable, chevron 12 px, contenu en grille 2 colonnes label/valeur.
- **Track (timeline)** : rang 28 px, vignette 20 px de la couche au début de son strip,
  strip de la couche en --bg-2, keyframes en losange accent, sous-rangs par canal quand
  déplié.
- **Selection outline (viewport)** : contour 1.5 px accent projeté en écran, poignées
  carrées 7 px, guides de snapping 1 px accent pointillés.

## Motion

Transitions d'interface 120 à 180 ms, ease-out-quart. Aucun mouvement décoratif.
Pas d'animation de propriétés de layout.
