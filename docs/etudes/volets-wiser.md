# Étude : piloter les volets Wiser selon la température ou la consommation ?

*Statut : terminée, novembre 2026. Issues : S-9.4, S-9.5. Décision en fin de document.*

## L'idée

Ouvrir ou fermer automatiquement les volets roulants Schneider **Wiser** selon la température mesurée
(station Netatmo, intérieur et extérieur) ou la consommation électrique, et éventuellement mesurer la
part de consommation des volets.

## Ce que sont les volets Wiser (gamme française)

| Produit | Référence | Protocole | Remarque |
|---|---|---|---|
| Interrupteur de volet Wiser Odace | S520567 (W) | Zigbee 3.0 | Reconnu par Zigbee2MQTT (position, durée de course) ; **ne mesure pas la puissance** |
| Micromodule volet Wiser | CCT5015-0002W | Zigbee 3.0 | Annoncé compatible Zigbee2MQTT |
| Passerelle Wiser Gen 2 | CCT501801 | Wi-Fi + Zigbee | Nécessaire pour l'accès à distance ; pont Matter depuis 2025 mais **sans les volets** (à vérifier) |

**À relever chez vous** : la référence imprimée sur le mécanisme (sous l'enjoliveur) et celle de la
passerelle. Sources : [Zigbee2MQTT S520567](https://www.zigbee2mqtt.io/devices/S520567.html),
[FAQ Schneider](https://se.com/fr/fr/faqs/FAQ000264705).

**Il n'existe pas d'API cloud Wiser documentée.** On pilote les volets soit par l'intégration
communautaire Home Assistant [wiserHomeAssistantPlatform](https://github.com/asantaga/wiserHomeAssistantPlatform)
(via la passerelle), soit en appairant les interrupteurs directement à un coordinateur Zigbee
(ZHA ou Zigbee2MQTT, tout en local).

Conséquence pour ce projet : **GitHub Actions, dans le cloud, ne peut pas atteindre les volets.** Toute
commande passe par un équipement allumé en permanence chez vous (voir
[plateforme-domotique.md](plateforme-domotique.md)).

## Le gain attendu

| Levier | Effet | Ordre de grandeur pour la maison |
|---|---|---|
| Volets fermés la nuit en hiver | « jusqu'à 60 % » de pertes en moins **par les fenêtres** (ADEME) ; 15 à 33 % en double vitrage | Fenêtres ≈ 10 à 15 % des déperditions → **1 à 5 % du chauffage**, soit environ 60 à 300 kWh/an, **15 à 70 €/an** |
| Volets ouverts au soleil (façade sud) | Apports solaires gratuits | Faible à modéré, très dépendant de l'orientation |
| Volets fermés au soleil en été | Confort (pas de climatisation ici) | Pas d'économie d'électricité |

Sources : [Selectra / ADEME](https://selectra.info/energie/actualites/marche/volets-fermes-soir-60-pourcent-pertes-fenetres),
[Legrand](https://www.legrand.fr/pro/questions-frequentes/quelle-economie-de-chauffage-peut-on-realiser-grace-a-la-gestion-automatique-des-volets-roulants).
Les pourcentages sur la facture sont **des estimations à vérifier par la mesure**.

**L'essentiel du gain vient d'une règle simple : fermer au coucher du soleil en hiver.** La température
mesurée n'ajoute presque rien l'hiver ; elle sert surtout au confort d'été. La consommation électrique
n'est **pas** un bon déclencheur : elle suit le froid, qui est déjà connu par la température et l'heure.

## La consommation des volets

| Poste | Hypothèse | Par an |
|---|---|---|
| Moteurs | 8 volets × 2 manœuvres/jour × 20 s × 150 W | ≈ 5 kWh |
| Veille des interrupteurs connectés | 0,3 à 1 W chacun (à mesurer) | ≈ 20 à 70 kWh |
| Passerelle | 1 à 2 W | ≈ 10 à 18 kWh |
| **Total** | | **≈ 35 à 95 kWh, moins de 1,5 % du chauffage** |

Ce qui compte, c'est la **veille**, pas les manœuvres. Les interrupteurs S520567 ne mesurent pas la
puissance : un suivi continu demanderait du matériel en plus, pour un poste négligeable.

## Décision

| Question | Décision | Pourquoi |
|---|---|---|
| Construire une passerelle « volets » dans ce projet | **Non** | Gain de 15 à 70 €/an atteignable avec une simple règle horaire ; le pilotage relève d'une plateforme domotique locale, pas d'une application d'analyse dans le cloud |
| Automatiser les volets | **Oui, mais ailleurs, et simplement** | D'abord les programmations de l'application Wiser (coucher du soleil l'hiver). Plus tard, si vous installez Home Assistant : règles soleil + température Netatmo pour l'été |
| Mesurer l'effet | **Oui, avec ce projet** | Récit S-9.0 : noter 4 semaines d'hiver avec ou sans fermeture le soir et comparer la consommation nocturne à la signature énergétique (onglet Analyse) |
| Mesurer la consommation des volets | **Non (en continu)** | ≈ 35 à 95 kWh/an. Une mesure ponctuelle de la veille avec une prise wattmètre (≈ 15 €) suffit |

> **Mise à jour du 10/11/2026 (#200).** La décision ci-dessus porte sur le **pilotage** des volets, qui
> reste hors de ce projet. La **lecture** de leur état, pour mesurer leur effet sans saisie, a été
> demandée ensuite (#200) : elle est décrite ci-dessous. Rien ne commande les volets.

## Relevé automatique par le NAS (#200)

### Comment ça marche

```
passerelle Wiser ──(réseau local, toutes les 10 min, lecture seule)──▶ NAS Synology
NAS ──(une fois par nuit : journal du jour chiffré avec la clé PUBLIQUE)──▶ GitHub, workflow « Volets »
workflow ──(déchiffre avec la clé PRIVÉE, vérifie, résume par jour, rechiffre)──▶ data/volets.enc.json
application ──▶ carte « Volets fermés le soir » (Outils → Journaux → Volets)
```

- GitHub ne peut pas joindre votre réseau local : c'est le NAS qui lit la passerelle, avec le script
  `scripts/nas/volets.sh` (rien d'autre à installer : `sh`, `curl`, `openssl`, `awk`, tous présents
  sur DSM ; pas de Docker, pas de Python).
- Le NAS ne note que les **changements** (position 0 à 100 % et mouvement de chaque volet) et, au
  premier relevé de la journée, la position de chacun. Il compte aussi les relevés réussis heure par
  heure, pour savoir quels moments sont connus.
- Chaque nuit, il chiffre le journal de la veille avec un **certificat public** : même si quelqu'un
  le récupère, il ne peut pas le lire. Seul le workflow, avec la clé privée rangée dans un secret
  GitHub, l'ouvre. Le NAS rattrape jusqu'à 7 nuits non envoyées (coupure Internet).
- Si le NAS n'a rien à envoyer (passerelle injoignable, tâche arrêtée, certificat absent), il envoie
  **un code d'erreur** plutôt que rien : l'exécution du workflow « Volets » échoue alors en rouge et
  GitHub vous prévient par e-mail ; la carte de l'application affiche le message.
- Le workflow refuse tout journal qui ne suit pas exactement le format attendu (taille, lignes,
  valeurs, codes d'erreur connus) : rien n'est alors enregistré. Ses journaux publics ne contiennent
  que le jour et des nombres de relevés, jamais un nom, une position ni un identifiant.
- Dans `data/volets.enc.json` (chiffré comme le reste), par jour et par volet : heure de fermeture le
  soir, heure d'ouverture le matin, position moyenne, position à 22 h. Les identifiants de la
  passerelle sont remplacés par « v0 », « v1 »… ; les noms des volets sont gardés (chiffrés) pour
  l'affichage.

**Ce que compte l'application.** Un soir compte « volets fermés » quand **tous** les volets relevés
sont **fermés à 22 h** (position 0, comme la passerelle définit « fermé ») ; sinon il compte comme les
autres soirs. Le relevé de 22 h remplace la note de ce soir-là ; un soir sans relevé (NAS éteint,
passerelle injoignable vers 21 h ou 22 h) garde votre note s'il y en a une, sinon il est **laissé de
côté**, jamais deviné. 22 h et « tous les volets » sont des choix faits pour coller à la nuit comparée
(22 h → 7 h) et à la note manuelle « volets fermés ce soir » : à rediscuter si un volet ne se ferme
jamais (porte-fenêtre laissée ouverte, par exemple).

### Pas à pas (une seule fois, environ 45 minutes)

**1. Récupérer le secret de la passerelle.** La passerelle ne répond qu'avec son *secret*, qu'elle ne
donne qu'en mode configuration :

1. Appuyez brièvement sur le bouton **Setup** de la passerelle : son voyant clignote, elle crée un
   réseau Wi-Fi nommé `WiserHeatXXXXXX`.
2. Connectez un ordinateur (ou un téléphone) à ce réseau, puis ouvrez
   `http://192.168.8.1/secret` dans le navigateur.
3. La page affiche une longue suite de lettres et de chiffres : c'est le secret. Copiez-la dans un
   fichier sur votre ordinateur, **nulle part ailleurs** (ni e-mail, ni GitHub).
4. Appuyez de nouveau sur **Setup** (ou attendez une dizaine de minutes) : la passerelle revient sur
   votre Wi-Fi. Reconnectez l'ordinateur à votre box.

Le secret ne change pas tant que la passerelle n'est pas réinitialisée.

**2. Donner une adresse fixe à la passerelle.** Dans l'interface de votre box : *réseau* ou *DHCP* →
*baux statiques* (le nom varie), réservez une adresse à la passerelle (par exemple `192.168.1.50`).
Sans cela, son adresse peut changer après une coupure et le relevé échouera (« passerelle
injoignable »).

**3. Tester depuis le NAS.** Dans DSM : *Panneau de configuration → Terminal et SNMP → Activer le
service SSH*. Depuis l'ordinateur : `ssh votre-compte@adresse-du-nas`, puis :

```sh
# remplacez l'adresse ; le secret est demandé sans s'afficher
printf 'Secret : '; stty -echo; read S; stty echo; echo
printf 'header = "SECRET: %s"\n' "$S" | curl -sS --max-time 20 -K - http://192.168.1.50/data/v2/domain/ | head -c 300; echo
```

Vous devez voir du texte qui commence par `{"System":`. Si rien ne répond, vérifiez l'adresse ; si la
réponse est vide avec une erreur 401, le secret est faux. Une passerelle **de 2ᵉ génération** à jour
peut demander `https://` (ajoutez `-k`, son certificat n'est pas reconnu, ce qui est normal sur le
réseau local) ; la vôtre (CCTFR6310) est *a priori* de 1ʳᵉ génération, en `http://`.

**4. Installer le script.** Toujours en SSH :

```sh
mkdir -p ~/volets && cd ~/volets
curl -fsSLO https://raw.githubusercontent.com/Opaland/Netatmo/main/scripts/nas/volets.sh
chmod 700 volets.sh
```

**5. Fabriquer la paire de clés.** `./volets.sh cle` crée `volets-certificat.pem` (public, reste sur le
NAS) et `volets-cle-privee.pem` (privée). Affichez les deux à la suite :

```sh
cat volets-cle-privee.pem volets-certificat.pem
```

Dans GitHub : dépôt → *Settings → Secrets and variables → Actions → New repository secret*, nom
`VOLETS_PRIVATE_KEY`, valeur : **tout** le texte affiché (les deux blocs `-----BEGIN…` à `-----END…`).
Puis **supprimez la clé privée du NAS** : `rm volets-cle-privee.pem`. Le certificat est public :
vous pouvez le transmettre pour qu'il soit ajouté au dépôt (`scripts/nas/volets-certificat.pem`) ; le
workflow vérifie alors que la clé du secret lui correspond.

**6. Créer le jeton GitHub du NAS.** GitHub → photo de profil → *Settings → Developer settings →
Personal access tokens → Fine-grained tokens → Generate new token* :

- *Repository access* : **Only select repositories** → `Opaland/Netatmo` ;
- *Permissions → Repository permissions* : **Actions : Read and write**, rien d'autre (*Metadata :
  Read-only* est ajouté d'office) ;
- *Expiration* : un an (GitHub vous prévient avant l'échéance ; il faudra le refaire).

Ce jeton ne peut que lancer des workflows de ce dépôt : il ne peut ni lire vos données, ni modifier
le code. Copiez-le (`github_pat_…`), il ne sera plus affiché.

**7. Écrire la configuration.** Sur le NAS, `vi ~/volets/volets.conf` (ou l'éditeur de texte de DSM),
avec vos valeurs :

```sh
HUB=192.168.1.50
HUB_SECRET='le secret de l étape 1'
HTTPS=0
GITHUB_TOKEN='github_pat_...'
```

puis `chmod 600 ~/volets/volets.conf` (le script refuse de tourner si d'autres comptes peuvent le
lire). Vérifiez : `~/volets/volets.sh test` affiche la génération de la passerelle et chaque volet avec
sa position, sans jamais afficher le secret.

**8. Planifier les deux tâches.** DSM : *Panneau de configuration → Planificateur de tâches → Créer →
Tâche planifiée → Script défini par l'utilisateur*, avec **votre** compte (pas `root`) :

| Tâche | Programmation | Script |
|---|---|---|
| Volets — relevé | tous les jours, toutes les **10 minutes**, de 00:00 à 23:50 | `sh /volume1/homes/VOTRE-COMPTE/volets/volets.sh releve` |
| Volets — envoi | tous les jours à **00:30** | `sh /volume1/homes/VOTRE-COMPTE/volets/volets.sh envoi` |

(Le chemin exact du dossier personnel s'affiche avec `pwd` dans `~/volets`.) Cochez *Envoyer les
détails d'exécution par e-mail… uniquement en cas d'échec* si les notifications DSM sont réglées.

**9. Le lendemain.** Dans GitHub, onglet *Actions* → **Volets** : une exécution verte « volets du
<jour> ». Après la collecte de la nuit suivante (qui republie le site), la carte *Outils → Journaux →
Volets* affiche le **Relevé automatique**. Sur le NAS, `~/volets/donnees/volets.log` dit ce qui a été
envoyé.

**Arrêter.** Désactivez les deux tâches planifiées, supprimez `~/volets`, révoquez le jeton dans
GitHub et supprimez le secret `VOLETS_PRIVATE_KEY`. Les jours déjà reçus restent dans
`data/volets.enc.json`.

### Ce qui reste incertain

- **Le secret** : la page `http://192.168.8.1/secret` est celle qu'utilise l'intégration Home
  Assistant ; certains micrologiciels récents pourraient ne plus la proposer (non vérifié sur la
  CCTFR6310).
- **La génération et le HTTPS** : `volets.sh test` affiche la génération déclarée par la passerelle.
  Les hubs de 2ᵉ génération à partir du micrologiciel 4.42.22 passent en HTTPS (aioWiserHeatAPI
  1.7.7) : il faudra alors `HTTPS=1`.
- **Les champs** : `CurrentLift` (0 = fermé, 100 = ouvert), `LiftMovement` et `ControlSource` sont
  ceux qu'utilise aioWiserHeatAPI 1.7.7 ; leurs valeurs exactes chez vous (par exemple le nom de
  l'origine « programmation » ou « manuel ») se verront au premier relevé. Une valeur de mouvement
  inconnue est notée « Other », sans bloquer.
- **Les droits du fichier de configuration** : sur DSM, le dossier personnel peut porter des ACL
  Windows ; si `chmod 600` ne suffit pas et que le script répond « droits trop larges », retirez les
  ACL de ce seul fichier (`synoacltool -del ~/volets/volets.conf`) puis refaites `chmod 600`.
- **La sortie Internet du NAS** vers `api.github.com` (port 443) est supposée ouverte.
- **L'horloge du NAS** doit être à l'heure (DSM : *Options régionales → Synchroniser avec un serveur
  NTP*) : un relevé daté hors de son jour fait refuser tout le journal.
- **Le délai** : le journal d'un jour arrive dans la nuit et s'affiche après la collecte suivante
  (≈ 6 h du matin), donc avec un jour de décalage.
- **Le journal est chiffré, pas signé** : toute personne qui a le
  certificat public peut fabriquer un journal, mais seul le jeton du NAS (ou un compte qui a les
  droits Actions sur le dépôt) peut lancer le workflow, et le contrôle strict limite ce qu'un faux
  journal pourrait écrire à des positions de volets fausses.
