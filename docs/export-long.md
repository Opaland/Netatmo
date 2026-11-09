# Export long (JSON et CSV) — format version 1

Menu ⋮ → **Export long (CSV)** ou **Export long (JSON)**. Le fichier est construit **dans le
navigateur**, à partir des données déjà déchiffrées : rien n'est envoyé nulle part. Il contient
tout l'historique, sans tenir compte des filtres (pièces, catégorie) de l'écran.

Il s'adresse à Home Assistant, Node-RED, un tableur ou un script : une ligne par **jour**, **entité**
et **grandeur**, avec point décimal et dates ISO. Pour Excel en français, l'export CSV historique
(`;`, virgule décimale) reste disponible.

- Schéma JSON (draft 2020-12) : [`export-long.schema.json`](export-long.schema.json). La CI vérifie
  que l'export des données de démonstration le respecte (`web/src/export.test.ts`).
- Nom des fichiers : `energie-long-v1-AAAA-MM-JJ.csv` / `.json` (le `v1` est la version du format).

## Colonnes

| Colonne | Type | Exemple | Sens |
|---|---|---|---|
| `date` | `AAAA-MM-JJ` | `2025-01-12` | Jour **local** de la maison (fuseau `timezone` du JSON, en général `Europe/Paris`) |
| `source` | texte | `intuis` | D'où vient la valeur (voir ci-dessous) |
| `entity` | texte | `Salon` | Pièce, module ou `logement` / `exterieur` |
| `metric` | texte | `energy` | Grandeur |
| `value` | nombre | `12.345` | Point décimal, jamais de séparateur de milliers |
| `unit` | texte | `kWh` | `kWh`, `°C`, `kVA`, `%` ou `ppm` |

Les lignes sont triées par date, source, entité puis grandeur. Une valeur absente n'est pas écrite
(pas de cellule vide).

## Sources, entités et grandeurs

| `source` | `entity` | `metric` | `unit` | Arrondi | Contenu |
|---|---|---|---|---|---|
| `intuis` | nom de la pièce | `energy` | kWh | 0,001 | Consommation du jour (radiateurs, chauffe-eau). Les jours « estimés » (reconstitués depuis le total du mois) y figurent, comme dans l'appli |
| `intuis` | nom de la pièce | `temperature` | °C | 0,01 | Température mesurée, moyenne du jour |
| `intuis` | nom de la pièce | `setpoint` | °C | 0,01 | Consigne moyenne du jour |
| `linky` | `logement` | `energy` | kWh | 0,001 | Consommation du logement entier (compteur Linky) |
| `linky` | `logement` | `power_max` | kVA | 0,01 | Puissance maximale appelée du jour |
| `weather` | `exterieur` | `temperature_min`, `temperature_max`, `temperature_mean` | °C | 0,01 | Météo extérieure (Open-Meteo ou module extérieur Netatmo) |
| `station` | nom du module | `temperature_min`, `temperature_max`, `temperature_mean` | °C | 0,01 | Station météo Netatmo, chaque module |
| `station` | nom du module | `humidity` | % | 0,1 | Humidité moyenne du jour |
| `station` | nom du module | `co2` | ppm | 1 | CO₂ moyen du jour (modules intérieurs) |

Les pièces classées « ignorer » ne sont pas exportées. Aucune donnée horaire, aucun identifiant
(maison, pièce, module), aucune coordonnée n'est écrit ; les noms de pièces et de modules, eux, le
sont : le fichier est pour vous, gardez-le comme vos données.

## CSV

RFC 4180 : séparateur `,`, guillemets seulement si un nom contient `,` ou `"`, fin de ligne `\n`,
UTF-8 sans BOM. Première ligne : `date,source,entity,metric,value,unit`.

```csv
date,source,entity,metric,value,unit
2025-01-12,intuis,Salon,energy,12.345,kWh
2025-01-12,intuis,Salon,setpoint,19.5,°C
2025-01-12,linky,logement,power_max,8.42,kVA
2025-01-12,weather,exterieur,temperature_mean,2.31,°C
```

## JSON

```json
{
  "format": "intuis-history-long",
  "version": 1,
  "generated": "2026-11-09T10:00:00.000Z",
  "timezone": "Europe/Paris",
  "first_day": "2022-01-01",
  "last_day": "2026-11-08",
  "columns": ["date", "source", "entity", "metric", "value", "unit"],
  "rows": [{ "date": "2025-01-12", "source": "intuis", "entity": "Salon", "metric": "energy", "value": 12.345, "unit": "kWh" }]
}
```

## Versions

Toute modification incompatible (colonne, grandeur ou unité renommée ou retirée) incrémente
`version` (et le `vN` du nom de fichier) et met à jour le schéma. Ajouter une grandeur ou une source
est aussi signalé ici, car le schéma refuse les valeurs inconnues.

## Import dans Home Assistant ou Node-RED

Pistes, **procédure à vérifier** sur votre installation : dans Node-RED, un nœud *file in* + *csv*
(ou *json*) puis un filtre sur `source` / `metric` ; dans Home Assistant, les statistiques
externes s'importent par exemple avec l'intégration communautaire *Import Statistics* (une
statistique par couple `entity` + `metric`, les valeurs `energy` étant des sommes journalières).
