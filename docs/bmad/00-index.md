# Dossier BMAD : Historique énergie Intuitiv

*Novembre 2026. Dossier de cadrage produit, rédigé après la mise en service sur une installation réelle
(7 pièces, radiateurs fil pilote, Aqua Manager, données depuis novembre 2022).*

## BMAD en cinq lignes

**BMAD** (*Breakthrough Method for Agile AI-Driven Development*) organise un projet développé avec des
agents IA autour de rôles successifs, chacun produisant un artefact qui sert d'entrée au suivant :
**Analyst** (brief) → **PM** (PRD) → **Architect** (architecture) → **PO / Scrum Master** (épopées et
récits) → **Dev** → **QA**. Les artefacts sont versionnés avec le code et restent la source de vérité :
un agent ou un humain qui reprend le projet part de ces fichiers, pas de l'historique d'une conversation.
Ce dossier ajoute une revue par 50 personas pour mesurer les besoins avant de construire.

## Fichiers

| # | Fichier | Rôle BMAD | Contenu |
|---|---|---|---|
| 01 | [01-project-brief.md](01-project-brief.md) | Analyst | Problème, utilisateurs, objectifs, KPI, contraintes, risques |
| 02 | [02-revue-50-personas.md](02-revue-50-personas.md) | Analyst / UX | 50 personas, verdicts, propositions, synthèse des 15 besoins, mesure du besoin domotique et IA |
| 03 | [03-prd.md](03-prd.md) | PM | Vision, personas retenus, exigences FR / NFR, hors périmètre, plan de versions |
| 04 | [04-architecture.md](04-architecture.md) | Architect | Architecture actuelle, modèle de données chiffré, couche IA, pont local, ADR |
| 05 | [05-epics-stories.md](05-epics-stories.md) | PO / SM | Épopées, récits utilisateur, critères d'acceptation, taille, priorité, statut |
| 06 | [06-qa-strategy.md](06-qa-strategy.md) | QA | Stratégie de test, matrice de risques, définition de « terminé » |

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

## Conventions

- Identifiants : `FR-x` exigences fonctionnelles, `NFR-x` non fonctionnelles, `E-x` épopées,
  `S-x.y` récits, `ADR-x` décisions d'architecture.
- « **à vérifier** » signale une affirmation technique non testée sur le matériel du propriétaire.
- Ces fichiers ne contiennent aucune donnée de consommation réelle : seuls les faits d'installation
  ci-dessus sont repris.
