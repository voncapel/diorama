# Conteneurs et reveal

Chaque couche possède un `THREE.Group` pour ses transformations, et une surface
indépendante portant le contenu. Les enfants d'un groupe sont attachés au
conteneur parent. Les transformations se transmettent aux enfants ; le masque
reste propre à chaque surface.

Dans l'inspecteur, la section **Révélation** expose trois canaux animables :

- **Ouverture** : 0 % masque entièrement la surface, 100 % l'affiche entièrement.
- **Direction** : 0° de gauche à droite, 90° de haut en bas, −90° de bas en haut,
  180° de droite à gauche. Les angles intermédiaires sont possibles.
- **Douceur intérieure** : largeur du bord progressif en pixels locaux, avant
  l'échelle du conteneur. À 0, le bord est net.

Pour un swipe, poser une clé d'ouverture à 0 %, puis une clé à 100 %. La taille et
les coordonnées de texture du contenu restent fixes. Le scale continue d'agrandir
l'élément complet. Les déformations des coins restent appliquées à la surface.

Le masque est partagé entre les matériaux avec et sans lumière, les ombres et la
passe de profondeur de champ. Les passes de profondeur utilisent un tramage pour
représenter la couverture du feather. Le picking tient compte de la zone révélée.
Les anciennes scènes reçoivent une ouverture de 100 % par défaut.

## Validation

- `npm run build` : types et compilation de l'extension.
- `node --test tests/layer-reveal.test.ts` (Node avec prise en charge TypeScript).
- Avec `npm run dev`, ouvrir `/tests/reveal-browser.html` : tests WebGL réels
  (pixels, picking, matériaux, groupes, compatibilité et profondeur de champ).
  Le résultat est également disponible dans `window.revealRegression`.
