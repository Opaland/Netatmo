# 01 · Brief projet (Analyst)

## 1. Problème

L'application officielle **Intuitiv with Netatmo / Intuis Connect** montre la consommation des
radiateurs et du chauffe-eau, mais :

| Limite de l'application officielle | Conséquence pour le foyer |
|---|---|
| Historique consultable limité | Impossible de juger une tendance sur plusieurs hivers |
| Pas de comparaison d'une année sur l'autre | « Avons-nous consommé plus que l'an dernier ? » reste sans réponse |
| Pas de lien avec la météo | Une baisse peut venir d'un hiver doux autant que d'un meilleur réglage |
| Coût calculé sur un seul prix | Faux depuis le passage en heures pleines / creuses (2025) |
| Pas d'export, mobile uniquement | Données captives |

Le problème de fond n'est plus « voir » (v1.0 le résout) mais **comprendre et décider** : quelle
pièce, quel usage, quel réglage explique l'écart, et combien cela coûte en euros.

## 2. Utilisateurs

| Segment | Description | Poids |
|---|---|---|
| Propriétaire technophile | A installé le projet, lit les graphiques, veut le « pourquoi » | Primaire |
| Membres du foyer | Consultent sur téléphone, veulent un verdict en euros | Primaire |
| Analyste du dimanche | Signature énergétique, DJU, profils horaires | Secondaire |
| Autres possesseurs d'Intuitiv | Clonent le dépôt (modèle) | Secondaire, v2 |
| Professionnels (installateur, bailleur, association) | Rapports, plusieurs logements | Exploratoire, non engagé |

## 3. Objectifs

| # | Objectif | Horizon |
|---|---|---|
| O1 | Archive complète, sans trou, depuis novembre 2022, qui survit à l'application officielle | Atteint, à maintenir |
| O2 | Expliquer un écart N-1 → N par la météo, la pièce et l'heure | v1.1 |
| O3 | Afficher un coût juste (HP/HC + abonnement) et une projection de fin d'année | v1.1 |
| O4 | Être lisible par toute la famille, y compris un senior, sur un téléphone d'entrée de gamme | v1.2 |
| O5 | Ne jamais perdre de données en silence | v1.1 (alerte) |
| O6 | Décider sur mesure, et non sur intuition, de l'intérêt d'un pont local et de l'IA | v1.2-v1.3 |

## 4. Indicateurs (KPI)

| KPI | Cible | Mesure |
|---|---|---|
| Complétude des jours collectés (dernière année) | ≥ 99 % | `python -m collector verify` + contrôle des jours manquants |
| Écart avec l'application officielle (total mensuel chauffage) | ≤ 1 % | Vérification manuelle, déjà faite pour janvier : égalité |
| Délai de détection d'un échec de collecte | < 24 h | Issue GitHub automatique (e-mail) |
| Temps jusqu'au premier graphique, téléphone d'entrée de gamme, cache chaud | < 3 s | Mesure Playwright avec bridage CPU ×4 |
| Coût d'exploitation | 0 € hors IA ; IA < 1 € / mois (à vérifier sur facture) | Factures GitHub / Anthropic |
| Usage de la carte verdict par la famille | Consultée au moins une fois par mois | Déclaratif (aucune télémétrie, par choix) |
| Fiabilité de la synthèse IA | 0 chiffre faux sur 3 mois consécutifs | Relecture croisée avec les chiffres calculés |

Pas de télémétrie : les KPI d'usage sont déclaratifs, c'est un choix de vie privée (NFR-2).

## 5. Contraintes

| Contrainte | Origine | Impact sur la conception |
|---|---|---|
| **API Intuis non officielle** | Aucune API publique ; `client_id`/`client_secret` de l'application mobile | Peu d'appels (une collecte/nuit), méthodes de mesure auto-détectées, URL de secours, données déjà archivées conservées |
| **Dépôt public** | Hébergement gratuit GitHub Pages | Tout fichier de données est chiffré (AES-256-GCM, PBKDF2 600 000 itérations) ; seuls `keyinfo.json` (sel) et les métadonnées Git sont publics |
| **Zéro serveur** | Pas de machine à maintenir | Calcul dans GitHub Actions (nuit) ou dans le navigateur ; aucun backend |
| **Gratuit** | Projet personnel | Open-Meteo sans clé, API Netatmo officielle gratuite, quotas Actions gratuits ; seule l'IA a un coût, borné |
| **Cloud sans accès au réseau local** | GitHub Actions ne voit pas le LAN | Volets Wiser, Hue, NAS, CPL ne sont accessibles que depuis un agent local (pont) |
| **Types de mesure instables** | `sum_energy_elec_heating` → `sum_energy_elec` → `$1`/`$2` | Le collecteur interroge les trois familles et garde la plus grande valeur par pièce et par jour |
| **Chauffe-eau au niveau module** | La pièce NMW ne renvoie rien | Interrogation de `home.modules` pour l'Aqua Manager |

## 6. Risques

| Risque | Prob. | Impact | Atténuation |
|---|---|---|---|
| Coupure ou changement de l'API Intuis | Moyenne | Élevé | Archive conservée, diagnostic anonyme, alerte d'échec, demande d'accès officiel (contact-api@netatmo.com) |
| Phrase de passe faible ou perdue | Moyenne | Élevé | Recommandation ≥ 5 mots, indicateur de robustesse, commande `rekey` (v1.2) |
| Inférence d'absences via les métadonnées publiques (taille, date des commits) | Faible | Moyen | Commit nocturne systématique, branche `data` ou dépôt privé de données (option) |
| Hallucination ou chiffre faux dans la synthèse IA | Moyenne | Moyen | Chiffres calculés en amont et injectés, l'IA ne fait que rédiger ; contrôle automatique des nombres cités |
| Fuite de la clé Anthropic | Faible | Moyen | Secret GitHub uniquement, plafond de dépense côté console, jamais dans le site |
| Dérive de périmètre vers la domotique | Élevée | Moyen | ADR-6 : pas de pilotage dans l'application ; pont local en lecture seule seulement si le besoin est mesuré |
| Croissance de l'historique Git (un commit par nuit) | Certaine | Faible | Écriture seulement si le contenu change ; branche `data` dédiée |
| Usage contraire aux CGU Intuis | Inconnue | Élevé | Usage strictement personnel, faible débit ; à vérifier par lecture des CGU, aucune redistribution des identifiants |

## 7. Hors champ du brief

Pilotage des radiateurs (l'application officielle et Home Assistant le font), facturation réelle du
fournisseur, consommation Linky du foyer entier (piste future, non engagée).
