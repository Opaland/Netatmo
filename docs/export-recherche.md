# Export recherche anonymisé — format version 1

Outils → Exporter mes données → **Export recherche (anonymisé)**. Pour un chercheur ou un étudiant qui veut caler un modèle
thermique sur un vrai logement, sans donnée personnelle. Le fichier est construit **dans le
navigateur**, à partir des données déjà déchiffrées : rien n'est envoyé nulle part. Avant d'être
proposé, il passe par le **détecteur** du rapport anonymisé (S-6.4) : s'il y trouve un nom de
logement, de pièce ou de module, un identifiant, ou (dates décalées) une date réelle, l'export est
refusé et la boîte dit ce qui a été trouvé.

Vous choisissez :

| Choix | Valeurs | Par défaut |
|---|---|---|
| Licence de diffusion | `CC-BY-4.0`, `CC0-1.0`, `ODbL-1.0`, `CC-BY-NC-4.0` | aucune : à choisir |
| Décaler les dates | oui : `time` en heures depuis une origine relative ; non : date et heure locales | oui |
| Localisation approximative | zone climatique `H1a` … `H3` (RE 2020), ou rien | non communiquée |
| Format | CSV (en-tête commenté) ou JSON | CSV |

Nom des fichiers : `energie-recherche-v1.csv` / `.json` (pas de date dans le nom).

## Ce qui est anonymisé

| Donnée | Dans l'export |
|---|---|
| Nom et identifiant du logement | jamais écrits |
| Pièces (nom, identifiant) | pseudonymes `Pièce A`, `Pièce B`… par consommation décroissante, `Chauffe-eau` (`Chauffe-eau 1`, `2`… s'il y en a plusieurs), comme le rapport anonymisé |
| Modules de la station (nom, adresse MAC) | `Capteur 1`, `Capteur 2`… (modules intérieurs, dans l'ordre de la station) ; le module extérieur devient `exterieur_station` |
| Dates | décalées par défaut : `time = 0` à minuit (heure locale) du premier jour exporté, qui n'est écrit nulle part ; la date de génération n'est pas écrite non plus |
| Localisation | aucune coordonnée ; seulement la zone climatique si vous la choisissez |
| Travaux (S-6.2) | leur nature seulement (`isolation`, `menuiseries`…), datée comme le reste ; la précision saisie à la main n'est jamais exportée |
| Surfaces (S-6.2) | surface en m² de chaque pièce pseudonymisée, si saisie |
| Pièces « ignorées » | absentes |

## Colonnes

| Colonne | Type | Exemple | Sens |
|---|---|---|---|
| `time` | entier (heures) ou `AAAA-MM-JJTHH:00` | `8760` | Début de la mesure : heures depuis l'origine (dates décalées) ou date et heure locales |
| `step_h` | `1` ou `24` | `1` | Durée couverte : une heure, ou un jour entier (alors `time` = minuit) |
| `entity` | texte | `Pièce A` | Pièce pseudonymisée, `Chauffe-eau`, `logement`, `exterieur`, `exterieur_station`, `Capteur n` |
| `metric` | texte | `energy` | Grandeur (tableau ci-dessous) |
| `value` | nombre | `0.512` | Point décimal |
| `unit` | texte | `kWh` | `kWh`, `°C`, `%` ou `ppm` |

Lignes triées par `time`, journalier avant horaire, puis entité et grandeur. Une valeur absente n'est
pas écrite.

| `entity` | `metric` | `step_h` | `unit` | Source |
|---|---|---|---|---|
| pièce, chauffe-eau | `energy` | 24 | kWh | Intuis, total du jour (jours perdus reconstitués depuis le total du mois, comme dans l'appli) |
| pièce, chauffe-eau | `energy` | 1 | kWh | Intuis, par heure (années où la collecte l'a récupéré) |
| pièce | `temperature`, `setpoint` | 24 | °C | Intuis, moyenne du jour (mesure du radiateur, consigne) |
| `logement` | `energy` | 24 | kWh | Compteur Linky, jour |
| `logement` | `energy` | 1 | kWh | Courbe de charge Linky (30 min regroupées par heure) |
| `exterieur` | `temperature_min`, `temperature_max`, `temperature_mean` | 24 | °C | Open-Meteo ou station Netatmo |
| `Capteur n`, `exterieur_station` | `temperature`, `humidity`, `co2` | 1 | °C, %, ppm | Station Netatmo, par heure (CO₂ : modules intérieurs) |

Une même grandeur peut donc exister au pas journalier **et** horaire : filtrez sur `step_h`.

**Heures locales.** Les heures sont celles du logement ; un jour compte toujours 24 h, y compris aux
changements d'heure (au printemps, une heure manque ; à l'automne, les deux heures répétées sont
additionnées par la collecte).

## CSV

RFC 4180 (séparateur `,`, guillemets seulement si nécessaire, fin de ligne `\n`, UTF-8 sans BOM),
précédé d'un en-tête de lignes commençant par `#` (à ignorer à la lecture, par exemple
`pandas.read_csv(f, comment='#')`) :

```csv
# energie-recherche v1 — jeu de données de recherche anonymisé, un seul logement chauffé à l'électricité
# Licence : CC-BY-4.0 (Creative Commons Attribution 4.0), choisie par la personne qui a exporté ces données
# Limite : Un seul logement : aucune généralisation possible, ni moyenne, ni tendance nationale.
# Limite : …
# Temps : time = 0 : minuit (heure locale) du premier jour exporté, date non communiquée ; step_h = 1 (valeur horaire) ou 24 (valeur journalière, time = minuit)
# Localisation : zone climatique H2b
# Entités : Chauffe-eau (chauffe-eau) ; Pièce A (chauffage, 22.5 m²) ; … ; logement (logement) ; exterieur (exterieur) ; Capteur 1 (capteur)
# Travaux : time 30672 Isolation
# Documentation : docs/export-recherche.md
time,step_h,entity,metric,value,unit
0,24,Pièce A,energy,12.345,kWh
0,24,exterieur,temperature_mean,2.31,°C
5,1,Pièce A,energy,0.6123,kWh
```

## JSON

```json
{
  "format": "energie-recherche",
  "version": 1,
  "license": "CC-BY-4.0",
  "license_name": "Creative Commons Attribution 4.0",
  "limits": ["Un seul logement : …"],
  "time": { "shifted": true, "origin": "time = 0 : minuit (heure locale) du premier jour exporté, date non communiquée", "unit": "h", "timezone": "locale" },
  "location": { "climate_zone": "H2b" },
  "generated": null,
  "entities": [{ "entity": "Pièce A", "kind": "chauffage", "surface_m2": 22.5 }],
  "events": [{ "time": 30672, "kind": "isolation", "label": "Isolation" }],
  "openings": null,
  "columns": ["time", "step_h", "entity", "metric", "value", "unit"],
  "rows": [{ "time": 0, "step_h": 24, "entity": "Pièce A", "metric": "energy", "value": 12.345, "unit": "kWh" }]
}
```

`openings` est réservé aux ouvertures de fenêtres : elles ne sont pas encore relevées dans la durée
(l'API ne les donne qu'en instantané), le champ vaut `null`.

## Limites (rappelées dans le fichier)

- **Un seul logement** : aucune généralisation, ni moyenne, ni tendance.
- L'énergie vient des appareils Intuis (pas d'un compteur certifié) ; les jours perdus sont
  reconstitués depuis les totaux mensuels.
- **Ré-identification** : la météo extérieure, croisée avec une archive (Open-Meteo, Météo-France),
  peut aider à retrouver la région et les dates réelles, même décalées. Ne publiez pas le fichier
  avec d'autres indices (ville, photos, dates de travaux connues) ; préférez « Localisation : non
  communiquée » si la zone climatique suffirait à recouper.
- Le décalage garde l'ordre et l'écart des jours, et l'heure du jour (`time` modulo 24) ; le jour de
  la semaine n'est pas donné.

## Versions

Toute modification incompatible (colonne, grandeur ou unité renommée ou retirée) incrémente
`version` (et le `vN` du nom de fichier). La CI vérifie sur la démonstration qu'aucun nom, identifiant
ni date réelle ne fuit (`web/src/research.test.ts`, et `web/e2e/features.mjs` sur le fichier
téléchargé).
