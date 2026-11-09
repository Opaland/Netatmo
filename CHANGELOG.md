# Historique des versions

## v1.3 — novembre 2026 : confort, coûts, robustesse, sécurité

- **Contrat partagé** entre tous les appareils (variable de dépôt `CONTRACT_JSON`, validée par le
  collecteur, rangée dans la méta chiffrée) ; verrouillage après inactivité ; clé mémorisée 30 jours.
- **Vue Confort** : CO₂ nocturne des chambres, humidité de la cave et point de rosée, heures sous
  19 °C (seuil réglable), sonde du radiateur comparée à la station dans la même pièce.
- **Courbe de charge Linky** (30 min) : journée type, talon, pic de 12 mois ; **sauvegarde chiffrée**
  téléchargeable et commande `restore-backup`.
- **Coûts** : budget annuel et projection, empreinte CO₂ (facteur modifiable), effet d'un nouveau
  tarif réglementé, coût d'une journée de télétravail, absences détectées.
- **Analyses** : chauffe-eau en heures creuses, simulateur de consigne (±2 °C), signature sur l'écart
  intérieur − extérieur, soirs « volets fermés » notés à la main.
- **Qualité des données** : jours réels / estimés / perdus par mois, jours perdus reconstitués à part
  (Linky ou signature), jours « suspects », exclus des jours inhabituels.
- **IA** : faits enrichis, pièces pseudonymisées (« Pièce A… »), coût et utilité de chaque analyse,
  questions types sans IA.
- **Exports** : CSV/JSON long documenté (`docs/export-long.md`), rapport annuel anonymisé,
  comparateur d'offres et pic de puissance dans le rapport.
- **Collecteur** : détection des changements de format des API, compteur et plafond d'appels par
  source, champs de `homestatus` listés par le diagnostic (fenêtre ouverte disponible, #162) ;
  issue automatique « Jeton à renouveler ».
- **Sécurité** : Trusted Types imposés par la CSP, attestation de build et empreintes SHA-256
  publiées (`gh attestation verify`).
- **Accessibilité et mobile** : audit axe dans la CI, contraste élevé et taille de texte système,
  balayage pour changer de période ou d'onglet, pièce épinglée, hors-ligne préparé.
- **Vie privée du foyer** : vue foyer qui regroupe les chambres (désactivable par appareil).
- Cadre juridique (`docs/juridique.md`), `CONTRIBUTING.md` et devcontainer, démo complète.
- Revue de fin de version (`docs/bmad/revues/v1.3.md`) et cadrage v1.4 avec 62 personas.

## v1.2 — novembre 2026 : contrat, comparateur, station, paramètres

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
- Comparateur : simulation d'une autre puissance souscrite, avec alerte si le pic Linky la dépasse.
- Station : jours au-dessus de 1 000 ppm de CO₂ et de 65 % d'humidité par module.
- « Jours inhabituels » : écarts nets à la signature énergétique (règle déterministe, sans IA).
- Mode simple : verdict et chiffres clés en grands caractères.
- Paramètres : ce qui est public, ce qui part chez des tiers.
- Changement de puissance souscrite déduit du Linky (premier dépassement de l'ancienne puissance),
  ajouté au contrat d'un clic. Linky : lecture du format Enedis 2026.
- État de chaque source (dernier succès, dernier échec) dans Paramètres et le résumé de collecte.
- Accessibilité : résumé textuel de chaque graphique pour les lecteurs d'écran ; écran de chargement.
- Tests visuels automatiques de la démo (Playwright, 3 appareils, 5 vues) dans la CI.

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
