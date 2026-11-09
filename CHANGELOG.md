# Historique des versions

## v1.2 — en cours

- Mode projet : règles BMAD (`docs/PROJET.md`), gabarits d'issues et de PR, jalons, une issue par récit.
- Station Netatmo complète : salon, chambre des enfants, cave, extérieur (température, humidité, CO₂).
- Historique de contrat (offre, puissance par période) et fichiers de tarifs extensibles à d'autres
  fournisseurs ; comparateur EDF Base / HP-HC / Tempo jour par jour (couleurs Tempo réelles).
- Puissance maximale appelée (Linky) comparée à la puissance souscrite.
- Études : volets Wiser (no-go passerelle, mesure d'abord) et plateforme domotique ouverte
  (Home Assistant, matériel manquant).
- **Paramètres dans l'application** : saisie des identifiants, chiffrés dans le navigateur puis écrits en
  secrets GitHub ; lancement de la collecte. Jeton GitHub jamais stocké ; CSP stricte.
- Bandeau « données arrêtées » ; résumé de chaque collecte dans GitHub ; Dependabot.
- `rekey` (changer la phrase de passe, workflow dédié) et estimation de robustesse (`strength`).
- Dépendances : ECharts 6.1 (correctif XSS), Vitest 5, actions GitHub à jour.
- Revue 50 personas de la v1.2 (`docs/bmad/revues/v1.2.md`).

## v1.1 — novembre 2026 : comprendre sa consommation

- Historique complet depuis novembre 2022 : quatre types de mesure selon l'époque, chauffe-eau lu au
  niveau du module, jours perdus par le serveur reconstitués depuis les totaux mensuels (« estimés »).
- Coût au tarif réglementé EDF heures pleines / creuses, jour par jour (open data CRE), abonnement
  inclus ; ou prix personnels.
- Météo (Open-Meteo ou station Netatmo), degrés-jours, comparaison à climat égal, signature énergétique.
- Verdict du mois, projection de fin d'année, calendrier, profils horaires, températures des pièces,
  cascade par pièce, part dans la consommation Linky, rapport annuel imprimable.
- Analyse mensuelle rédigée par Claude, chiffres vérifiés, données envoyées visibles.
- Alerte par issue GitHub si la collecte échoue ; diagnostic anonyme de l'API.
- Cadrage BMAD et revue 50 personas.

## v1.0 — novembre 2026 : première version

- Collecte quotidienne chiffrée (GitHub Actions), PWA sur GitHub Pages, comparaison d'années, filtres
  par pièce et par usage, export CSV, mode démo.
