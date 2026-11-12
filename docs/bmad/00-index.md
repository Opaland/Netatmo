# Dossier BMAD : Historique énergie Intuitiv

*Novembre 2026. Dossier de cadrage produit, rédigé après la mise en service sur une installation réelle
(7 pièces, radiateurs fil pilote, Aqua Manager, données depuis novembre 2022).*

## BMAD en cinq lignes

**BMAD** (*Breakthrough Method for Agile AI-Driven Development*) organise un projet développé avec des
agents IA autour de rôles successifs, chacun produisant un artefact qui sert d'entrée au suivant :
**Analyst** (brief) → **PM** (PRD) → **Architect** (architecture) → **PO / Scrum Master** (épopées et
récits) → **Dev** → **QA**. Les artefacts sont versionnés avec le code et restent la source de vérité :
un agent ou un humain qui reprend le projet part de ces fichiers, pas de l'historique d'une conversation.
Ce dossier ajoute une revue par 72 personas pour mesurer les besoins avant de construire.

## Fichiers

| # | Fichier | Rôle BMAD | Contenu |
|---|---|---|---|
| 01 | [01-project-brief.md](01-project-brief.md) | Analyst | Problème, utilisateurs, objectifs, KPI, contraintes, risques |
| 02 | [02-revue-50-personas.md](02-revue-50-personas.md) | Analyst / UX | 50 personas, verdicts, propositions, synthèse des 15 besoins, mesure du besoin domotique et IA ; § 12 : personas 51 à 62 ajoutés ; § 13 : personas 63 à 72 (fin de v1.6) |
| — | [revues/](revues/) | Analyst / PO | Revue de cadrage et de fin de chaque version (v1.2, v1.3, v1.4, v1.5, v1.6, v1.7, v1.8, v1.9, v2.0) |
| 03 | [03-prd.md](03-prd.md) | PM | Vision, personas retenus, exigences FR / NFR, hors périmètre, plan de versions |
| 04 | [04-architecture.md](04-architecture.md) | Architect | Architecture actuelle, modèle de données chiffré, couche IA, pont local, ADR |
| 05 | [05-epics-stories.md](05-epics-stories.md) | PO / SM | Épopées, récits utilisateur, critères d'acceptation, taille, priorité, statut |
| 06 | [06-qa-strategy.md](06-qa-strategy.md) | QA | Stratégie de test, matrice de risques, définition de « terminé » |
| — | [feuille-de-route.md](feuille-de-route.md) | PM / PO | Versions v1.8 à v2.1, jalon « Matériel », règle de passage d'une version à la suivante (12/11/2026) |

Documents antérieurs, toujours valables : [README](../../README.md), [notes API](../api-notes.md),
[étude de marché](../etude-marche.md), [feuille de route et revue à 6 personas](../feuille-de-route.md).

## Statut

| Élément | Statut |
|---|---|
| v1.0 : collecte nocturne chiffrée, comparaison d'années, PWA, CSV | Livré |
| v1.1 : coût HP/HC, météo et DJU, signature énergétique, calendrier, cascade, verdict, projection, profils horaires, températures, rapport annuel, alerte d’échec (faite), synthèse IA mensuelle, part dans le Linky | En cours (développement parallèle) |
| Chat IA dans l'application (clé fournie par l'utilisateur) | En évaluation, voir ADR-5 |
| Pont local (Synology / Home Assistant) | Proposé, conditionné à une mesure du besoin (ADR-7 à ADR-9) |
| Pilotage domotique (volets, Hue) | Hors périmètre de l'application (ADR-6) |
| v1.2 : contrat, comparateur, station, Paramètres | Livré ([revue](revues/v1.2.md)) |
| v1.3 : justesse des euros, confort, IA pseudonymisée, accessibilité en CI | Livré ([revue de fin](revues/v1.3.md)) |
| v1.4 : fenêtres ouvertes et états des radiateurs, Shelly, Home Assistant, simulateurs, revues par agents | Livré ([cadrage](revues/v1.4-cadrage.md), [revue de fin](revues/v1.4.md)) ; relevé horaire à activer par le propriétaire |
| v1.5 : revue de code complète par agents, corrections, suites de l'audit des données | Livré ([cadrage](revues/v1.5-cadrage.md), [revue de fin](revues/v1.5.md)) ; anciens journaux de collecte à supprimer et origine (#229) à décider par le propriétaire |
| v1.6 : revue design et UI/UX, nouveau design system | Reconstruite (tous les écrans sur le nouveau design system), **pas encore close** : [revue de fin](revues/v1.6.md) ; restent #317 (fin de migration, captures, test « hors jetons »), #383, #384 et la revue design par agents (#385) |
| v1.7 : finitions et données de la maison (lisibilité, incidents, poêle à bois, photovoltaïque, heures creuses) | Livré et clos ([revue de fin](revues/v1.7.md), § 11 : décisions du propriétaire, PR #455 et #458) ; restent les preuves du propriétaire (localisation, bois, heures creuses) |
| v1.8 : le bois et les réglages (bois dans l'isolation, réglages du foyer en secrets, ⚙ Mon logement, degrés-jours, stock de bois et flambées, heures creuses datées, bilan qualité) | Livré et clos ([revue de fin](revues/v1.8.md), 53 👍 / 18 ➖ / 1 👎 ; revue de code § 12, PR #503) ; restent les décisions (§ 10) et les preuves du propriétaire (§ 9) |
| v1.9 : sécurité et méthode (Argon2id, paliers de taille, contrat et alerte froid en secrets, ensoleillement, repère kWh/m²/an face au DPE, défi à climat égal, rapport de compatibilité) | Livré et clos ([revue de fin](revues/v1.9.md), 53 👍 / 18 ➖ / 1 👎 ; revue de code § 12, PR #519) ; restent la migration Argon2id des vraies données (#139), les décisions (§ 10) et les preuves du propriétaire (§ 9) |
| v2.0 : ouverture (guide d'installation et « dépôt prêt », assistant de premier lancement, branche `data`, copie locale sur le NAS, origine partagée signalée, page HTTP dite) | Livré en code ([revue de fin](revues/v2.0.md), 54 👍 / 17 ➖ / 1 👎 ; revue de code § 12) ; restent les gestes et preuves du propriétaire (§ 9 : NAS, branche `data`, modèle, transfert), les décisions (§ 10) ; pont (#25) et clé IA (#14) attendent leur condition |
| v2.1, jalon « Matériel » | [Feuille de route](feuille-de-route.md) |

## Conventions

- Identifiants : `FR-x` exigences fonctionnelles, `NFR-x` non fonctionnelles, `E-x` épopées,
  `S-x.y` récits, `ADR-x` décisions d'architecture.
- « **à vérifier** » signale une affirmation technique non testée sur le matériel du propriétaire.
- Ces fichiers ne contiennent aucune donnée de consommation réelle : seuls les faits d'installation
  ci-dessus sont repris.
