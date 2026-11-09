# Importer des statistiques Home Assistant (S-1.18)

Home Assistant tourne chez vous ; GitHub ne doit jamais l'atteindre (aucun port ouvert, aucun jeton
HA dans les secrets). Le chemin est donc **manuel et local** : vous exportez des statistiques depuis
HA, puis le collecteur, lancé sur votre ordinateur, les transforme en **agrégats quotidiens par
capteur** et les range **chiffrés** dans `data/ha.enc.json`. Vous commitez ensuite `data/` comme
après une collecte.

```bash
DATA_PASSPHRASE='…' python -m collector import-ha export.json --dry-run   # vérifier
DATA_PASSPHRASE='…' python -m collector import-ha export.json             # écrire
git add data/ha.enc.json data/meta.enc.json && git commit -m "data: import Home Assistant" && git push
```

Le collecteur n'affiche que des **comptes** (« 3 capteurs, 40 jours agrégés ») et, en cas de fichier
illisible, une **position** (« CSV : ligne 12, date illisible ») : jamais un nom d'entité ni une valeur.
Le fichier d'export lui-même est en clair : **ne le commitez pas** (supprimez-le après l'import).
Un nouvel import du même capteur remplace les jours qu'il contient et garde les autres.

## Formats acceptés

### 1. Historique, API REST de Home Assistant (recommandé)

Avec un [jeton longue durée](https://www.home-assistant.io/docs/authentication/#your-account-profile)
(profil HA → Sécurité), sur votre réseau local :

```bash
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  "http://homeassistant.local:8123/api/history/period/2026-10-01T00:00:00+01:00?end_time=2026-11-01T00:00:00%2B01:00&filter_entity_id=binary_sensor.fenetre_salon,sensor.prise_frigo_energy" \
  > export.json
```

La réponse est une liste de listes d'états (`entity_id`, `state`, `last_changed`, `attributes`),
`minimal_response` accepté. Les attributs `unit_of_measurement` et `device_class` servent à
reconnaître le type de capteur. L'historique HA n'est gardé que 10 jours par défaut (`purge_keep_days`) :
pour remonter plus loin, utilisez le format 3.

### 2. Historique, panneau « Historique » (CSV)

Panneau *Historique* → choisir les entités et la période → *Télécharger les données*. Colonnes
`entity_id,state,last_changed`. Sans unité dans le fichier : un compteur d'énergie n'y est reconnu
que si l'entité est nommée comme telle dans un export JSON précédent ; préférez le format 1.

### 3. Statistiques long terme (JSON)

La réponse de la commande websocket `recorder/statistics_during_period` (période `hour` ou `day`),
de préférence enveloppée avec les unités :

```json
{
  "units": {"sensor.prise_frigo_energy": "kWh"},
  "statistics": {
    "sensor.prise_frigo_energy": [{"start": 1730415600000, "sum": 1234.5, "change": 1.02}],
    "sensor.sonde_chambre": [{"start": "2026-11-01T00:00:00+01:00", "mean": 19.4, "min": 18.1, "max": 20.9}]
  }
}
```

`start` en millisecondes ou en ISO 8601. Une ligne avec `change` (ou `sum`) est un compteur
d'énergie ; avec `mean` / `min` / `max`, une grandeur. Sans `units`, un compteur est supposé en kWh.

## Ce qui est gardé

Par capteur (clé `h0`, `h1`…) et par **jour local** (fuseau de la maison) :

| Type reconnu | Règle | Valeur du jour |
|---|---|---|
| `opening` (`binary_sensor` de classe `door`, `window`, `opening`, `garage_door`, ou nom contenant fenêtre / porte / window / door) | durée à l'état ouvert, nombre d'ouvertures | `{"on_h": 2.5, "n": 3}` |
| `binary` (autre `binary_sensor`) | idem | `{"on_h": …, "n": …}` |
| `energy` (unité Wh / kWh / MWh ou classe `energy`) | différences du compteur, remises à zéro gérées | `{"kwh": 1.234}` |
| `temperature`, `humidity`, `power`, `numeric` | relevés du jour | `{"min": …, "max": …, "mean": …}` |

Avec les formats 1 et 2, seuls les **jours entiers** entre le premier et le dernier relevé sont
gardés (le premier et le dernier jour d'un export sont partiels). Les états `unavailable` et
`unknown` sont ignorés. Au plus 300 capteurs et 50 Mo par fichier.

Le document déchiffré suit le schéma publié [`import-ha.schema.json`](import-ha.schema.json) :

```jsonc
{
  "sensors": {"h0": {"entity": "binary_sensor.fenetre_salon", "name": "Fenêtre salon", "kind": "opening", "unit": ""}},
  "daily":   {"h0": {"2026-11-02": {"on_h": 1.5, "n": 2}}},
  "imported": "2026-11-09T18:00:00+00:00"
}
```

## Limites

- L'appli affiche ces agrégats dans la vue **Confort**, carte « Capteurs Home Assistant » (fichier
  chargé à la demande). Pour un capteur d'ouverture, choisissez la pièce équipée du radiateur (devinée
  d'après les noms, choix gardé sur l'appareil) : la carte donne le **taux d'accord par jour** avec
  `open_window` d'Intuis (relevé horaire, S-13.2). Un jour est « ouvert » pour une source à partir de
  30 minutes ; les deux côtés n'existent qu'en agrégats quotidiens, la comparaison est donc par jour,
  pas par heure. Une aération courte ou par temps doux échappe souvent au radiateur (« capteur seul »).
- Les capteurs d'ouverture rattachés à une chambre suivent la règle des chambres (S-13.5) : détail
  masqué tant que le détail des chambres n'est pas demandé.
- Aucun envoi automatique depuis HA : une automatisation qui pousserait vers GitHub demanderait un
  jeton GitHub dans HA et exposerait des valeurs dans les journaux publics d'Actions.
