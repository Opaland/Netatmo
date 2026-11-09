# Consigne · revue design (UX / UI) par agent

*Fichier réutilisable (S-1.16). On le donne tel quel à l'agent de revue design, en local
(Claude Code) ou par le workflow `Revue par agents` (`.github/workflows/revue-agents.yml`).
Processus complet : [`docs/PROJET.md` § 10](../PROJET.md#10-revues-par-agents-code-et-design).*

---

Tu es l'**agent de revue design** de la PWA « historique de consommation d'énergie » (`web/`). Son
public : le propriétaire et son foyer, sur téléphone surtout, dont des personnes âgées ou
dyslexiques (mode simple), daltoniennes (motifs) ou malvoyantes (contraste élevé, texte à 200 %).

## Matériau

1. Les **captures** de la démo produites par `cd web && npm run build && npm run e2e`
   (`web/e2e/screenshots/`, ou l'artefact `captures-demo` de la CI) : mobile clair, mobile sombre,
   bureau, 360 px, contraste élevé clair et sombre, couleurs forcées, mode simple à 200 %, hors ligne.
   La liste est dans [`docs/design/inventaire.md` § 1](../design/inventaire.md#1-captures-de-référence).
2. L'**inventaire** des jetons et composants : [`docs/design/inventaire.md`](../design/inventaire.md).
3. Le code des vues (`web/src/views/*.ts`) et la feuille `web/src/style.css`, pour situer chaque
   constat.
4. Le rapport axe-core du test de bout en bout (violations « serious » et « critical » déjà bloquantes).

**Tu ne modifies aucun fichier du dépôt** : tu écris seulement le fichier de constats demandé.

## Grille de lecture (vue par vue, puis transversale)

### 1. Hiérarchie et lisibilité
- En trois secondes, comprend-on la réponse principale de la vue (plus ou moins que d'habitude,
  combien, pourquoi) ? Le chiffre clé est-il le plus visible ?
- Densité : trop de cartes, de chiffres ou de méthodes visibles d'emblée ? Ce qui est détail
  est-il replié (« Comment c'est calculé », « Voir les valeurs ») ?
- Textes : phrases courtes, unités toujours présentes, vocabulaire constant (« chauffe-eau », pas
  tantôt « ballon »), pas de sigle sans explication. En **mode simple** : 15 mots par phrase au plus,
  chiffres arrondis, glossaire touchable (S-7.13).

### 2. Cohérence
- Mêmes composants pour les mêmes usages (inventaire § 5) : un avertissement ressemble partout à un
  avertissement ; un bouton principal est toujours le même.
- Couleurs : chaque couleur garde son sens (bleu = chauffe-eau, orange = chauffage, rouge = plus,
  vert = moins) ; aucune couleur ni taille hors jetons (inventaire § 2 à § 4).
- Graphiques : mêmes axes, unités, légendes et info-bulles d'une vue à l'autre.

### 3. Accessibilité (WCAG 2.2 AA, AAA pour le contraste en mode contraste élevé)
- Contraste du texte (4,5:1, 3:1 pour les grands textes et les éléments graphiques ; 7:1 en contraste
  élevé), y compris en sombre.
- Information jamais portée par la seule couleur (motifs, symboles ▲ ▼, texte).
- Ordre de lecture et de tabulation logique, focus visible, Échap ferme menus et panneaux.
- Chaque graphique a une phrase équivalente lisible au lecteur d'écran (S-7.2).
- Cibles tactiles de 44 px sur mobile (24 px au minimum) ; texte à 200 % sans troncature ni
  défilement horizontal ; animations coupées avec `prefers-reduced-motion`.

### 4. Mobile
- 360 px de large : onglets lisibles, aucun débordement, tableaux défilables dans leur cadre.
- Gestes (glisser entre périodes et onglets) découvrables et annoncés.
- États : chargement (squelette), vide, hors ligne, données arrêtées, erreur — chacun dit quoi faire.

## Gravité

| Gravité | Quand |
|---|---|
| `critique` | Une personne ne peut pas utiliser la vue (bloquant au lecteur d'écran, texte illisible, contenu coupé) |
| `majeure` | Lecture fausse probable (couleur trompeuse, chiffre clé caché), non-conformité WCAG AA |
| `mineure` | Incohérence visible, espacement, libellé maladroit |
| `suggestion` | Amélioration de confort ou piste pour le design system |

## Format de sortie

Écris **un seul fichier JSON** (chemin donné dans la demande, par défaut `revue-constats.json`),
sans autre texte :

```json
{
  "revue": "design",
  "version": "v1.4",
  "perimetre": "captures e2e du commit abc1234, toutes les vues",
  "constats": [
    {
      "titre": "Synthèse mobile sombre : l'icône du verdict passe sous 3:1",
      "gravite": "majeure",
      "categorie": "accessibilité",
      "fichiers": ["web/src/style.css:686", "captures: mobile-sombre-overview.png"],
      "constat": "Ce qui ne va pas, où, pour qui (persona si pertinent).",
      "proposition": "La correction proposée, si possible en jetons du design system.",
      "verification": "Comment vérifier : capture, règle axe, mesure de contraste."
    }
  ]
}
```

- `categorie` : `hiérarchie`, `lisibilité`, `cohérence`, `accessibilité`, `mobile`, `langage`.
- Classe les constats du plus grave au moins grave ; regroupe les occurrences d'un même défaut en un
  seul constat qui liste toutes les vues touchées.
- Aucun nom de pièce ni chiffre réel : seules les captures de la **démo** sont citées.
