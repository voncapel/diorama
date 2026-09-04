# Product

## Register

product

## Users

Un seul profil : le dev-designer produit. Mac Apple Silicon, Chrome Canary, exigeant sur
la qualité visuelle. Il fabrique des vidéos de lancement, démos et posts sociaux à partir de
ses propres landing pages, généralement le soir, seul, sur un MacBook Pro ou un écran
externe dans une pièce peu éclairée. Il connaît Figma, After Effects, Blender, DaVinci et
Linear ; il attend les mêmes réflexes (clic pour sélectionner, scrub sur les champs
numériques, raccourcis, snapping) et n'a pas besoin d'être guidé.

Tâche principale à l'écran : composer une scène 3D à partir des couches capturées,
animer caméra et couches sur une timeline, exporter en MP4.

## Product Purpose

Diorama est une extension Chrome qui transforme une page web vivante en scène 3D animée :
chaque élément « zappé » devient une couche texturée, la caméra 6-DoF, la profondeur de
champ et le motion blur produisent une vidéo 4K déterministe. Le Studio (onglet dédié) est
l'espace de composition et d'animation. Succès : un clip de 6 s crédible en moins de dix
minutes, sans jamais se sentir bridé par l'outil.

## Brand Personality

Précis, silencieux, cinématographique. L'interface est un plateau de tournage sombre :
le chrome s'efface, la page capturée (souvent claire) est la seule chose lumineuse.
Aucune pédagogie envahissante ; les affordances sont celles des outils pro.

## Anti-references

- Le « dashboard SaaS » : cartes identiques, métriques géantes, dégradés, glassmorphism.
- L'esthétique « outil dev bleu nuit » par réflexe (accent indigo, néon sur noir).
- Les éditeurs vidéo grand public sur-décorés (boutons colorés partout, icônes bavardes).
- Les panneaux de sliders empilés sans hiérarchie (l'état actuel du Studio).

## Design Principles

1. **La page est la star.** Le chrome est neutre et sombre pour que le viewport reste
   fidèle en couleur ; une seule couleur d'accent, réservée à la sélection, aux
   keyframes et à la tête de lecture.
2. **Manipulation directe d'abord.** Tout ce qui peut se faire dans le viewport ou sur la
   timeline s'y fait (clic, drag, scrub, snapping) ; l'inspecteur confirme et affine.
3. **Modulaire par construction.** Chaque propriété animable est un canal déclaré une
   fois (registre) et câblé automatiquement dans l'inspecteur, la timeline et le rendu.
4. **Densité d'expert.** Champs numériques compacts, unités visibles, valeurs tabulaires,
   pas de texte d'aide inline ; les raccourcis sont dans les infobulles.
5. **Le rendu est la vérité.** Preview et export sont le même pipeline ; rien dans l'UI ne
   suggère un état que le rendu ne montre pas.

## Accessibility & Inclusion

Cible : un utilisateur unique sur desktop, souris/trackpad et clavier. Contraste texte
AA sur les surfaces sombres, focus visible sur chaque contrôle, tous les gestes ont un
équivalent dans l'inspecteur (pas de fonction uniquement au drag), `prefers-reduced-motion`
respecté pour les transitions de l'interface (jamais pour la preview 3D, qui est le contenu).
