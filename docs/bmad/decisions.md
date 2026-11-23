# Les décisions du propriétaire, D1 à D97, en un seul tableau

*Tenu depuis la v3.0 (#680, story 5 du cadrage de la v3.0, PR #681). Relevé le
23/11/2026 sur `main` `0bde668` (clôture de la v2.9). Ce document **ne tranche rien** : il rassemble
les décisions que les revues de fin de version ont posées dans leur § 10, pour que le propriétaire
puisse répondre en une fois, sans ouvrir douze fichiers.*

## Comment lire ce tableau

**D'où viennent les décisions.** Chaque revue de fin de version, de la [v1.8](revues/v1.8.md) à la
[v2.9](revues/v2.9.md), a un § 10, « Décisions du propriétaire » : un choix de produit, de design,
d'architecture ou de rangement qu'un agent a rencontré et n'avait pas à faire seul (AGENTS.md §1).
**97 numéros** (D1 à D97) et **trois sous-décisions** (D36 bis, D37 bis, D37 ter), dans douze revues :
v1.8 : 16, v1.9 : 18, v2.0 : 9 (et les trois sous-décisions), v2.1 : 10, v2.2 : 9, v2.3 : 7, v2.4 : 8,
v2.5 : 3, v2.6 : 5, v2.7 : 4, v2.8 : 4, v2.9 : 4. Chaque ligne ci-dessous renvoie à sa revue, qui garde le
détail (et la PR qui l'a posée).

**Ce que veut dire l'état** (dernière colonne), lu dans les revues et les issues, jamais supposé :

- **ouverte** : rien n'a été fait ; il faut une réponse pour que quelque chose change ;
- **en place, à confirmer** : la PR a mis une forme en place, qui tourne aujourd'hui ; le propriétaire
  la garde ou choisit une autre piste. Ne rien répondre revient à la garder ;
- **appliquée par #n** : un changement l'a réglée, cité avec sa preuve ;
- **remplacée par Dn** : une décision plus récente porte la même question ;
- **sans objet** : la question ne se pose plus, avec la preuve.

**Aucune décision n'est tranchée par le propriétaire** dans un texte écrit, à la date du relevé :
aucune issue ni aucun commentaire du dépôt n'a été écrit par lui (relevé sur les 681 issues et PR et
leurs 440 commentaires : tous écrits par une session de Claude Code, par Dependabot ou par la collecte).
La seule décision du propriétaire relayée par écrit est celle de l'origine dédiée, le 09/11/2026 : elle
fixe la **destination** de D39, pas D39 elle-même (voir sa ligne).

**Comment répondre.** Une ligne par numéro suffit : « D2 : garder », « D29 : sous-pages », « D64 : 0,5 ».
Les décisions sont **regroupées par sujet** pour se trancher ensemble ; le § 8 donne l'ordre des numéros.
Une réponse devient une issue (ou une story de la version suivante) ; l'état de la ligne passe alors à
« tranchée le jj/mm/aaaa » avec le lien vers le texte du propriétaire.

**Deux listes « D1 ».** [`docs/design/audit-ux.md`](../design/audit-ux.md) numérote aussi D1 à D6, mais
ce sont des **défauts** de l'audit UX (texte à 200 %, étiquettes tronquées…), pas des décisions. L'audit
est daté et n'est pas renommé : un « D1 » cité avec une revue ou ce tableau est une décision ; cité avec
`audit-ux.md`, c'est un défaut de l'audit.

**Comment ce tableau reste juste.** `web/src/decisions.test.ts` lit le § 10 de chaque revue de fin et
vérifie que chaque décision y a **une** ligne ici, avec le lien vers sa revue, et qu'il n'y en a pas
d'autre. La revue de fin de la v3.0 et les suivantes **ajoutent leurs décisions ici** (une ligne
chacune) et mettent à jour l'état des lignes qu'elles touchent, au lieu de renvoyer aux revues
précédentes par plages (« D1 à D9 et D11 à D15 »).

## 1. Sécurité, confidentialité et compte GitHub

| # | La question | Aujourd'hui | Les options : ce que chacune débloque ou coûte | Posée par | État |
|---|---|---|---|---|---|
| D9 | Envoie-t-on à l'IA les jours inhabituels **avec leur date** (au plus cinq) ? | envoyés, et c'est dit partout | garder ; envoyer sans la date (jour de la semaine, rang) : moins précis, rien de daté ne sort ; ne plus les envoyer : l'IA ne les commente plus | [v1.8](revues/v1.8.md) · #365, PR #481 | en place, à confirmer |
| D10 | Les réglages `COLD_ALERT_JSON` et `CONTRACT_JSON` restent-ils des variables lisibles des collaborateurs ? | secrets depuis #506 | sceller en secrets ; garder l'alerte en variable avec des identifiants pseudonymisés ; garder | [v1.8](revues/v1.8.md) · § 6 n° 4 | appliquée par #506 (première piste, à la demande de la session de coordination ; revue v1.9 § 10 ; la suite est D30) |
| D11 | Active-t-on le **signalement privé des failles** de GitHub ? | désactivé | activer (un réglage du dépôt, geste du propriétaire) : ferme #364 ; laisser la phrase de repli de SECURITY.md seule | [v1.8](revues/v1.8.md) · #364, PR #492 | ouverte |
| D17 | Une note devenue illisible après un changement de phrase : peut-on la rouvrir en tapant **l'ancienne phrase** ? | pas de saisie ; effacer demande désormais une confirmation (#526) | une saisie de l'ancienne phrase dans le bandeau : la note se récupère ; garder : la note reste perdue | [v1.9](revues/v1.9.md) · PR #509 | ouverte (la confirmation avant d'effacer est appliquée par #526, revue v2.0 § 10 ; reste la saisie) |
| D18 | Lie-t-on le **nom du fichier** à son contenu chiffré (données associées GCM) ? | non (enveloppe `v: 1`) | format v2 lié, qui refuse les enveloppes v1 : un fichier renommé ne passe plus pour un autre, mais un passage de format à faire ; garder | [v1.9](revues/v1.9.md) · PR #509 | ouverte |
| D19 | Un **dossier neuf** est-il chiffré directement en Argon2id ? | PBKDF2 ; Argon2id seulement par `rekey` | Argon2id dès le départ : plus résistant, plus lent sur un vieux téléphone ; garder | [v1.9](revues/v1.9.md) · PR #509 | en place, à confirmer |
| D20 | Les **réglages d'Argon2id** (64 Mio, 2 passes, 1 voie) suffisent-ils ? | en place, mesurés hors téléphone | garder ; 3 passes après une mesure sur un vrai téléphone (geste) | [v1.9](revues/v1.9.md) · PR #509 | en place, à confirmer |
| D30 | Le contrat et l'alerte froid restent-ils des **secrets** que l'appli ne peut plus relire dans GitHub ? | secrets (D10 appliquée) | garder ; revenir à une variable pour l'alerte, identifiants pseudonymisés : l'appli peut la relire | [v1.9](revues/v1.9.md) · PR #506 | en place, à confirmer |
| D32 | Les **paliers de taille** des fichiers chiffrés (4 Ko jusqu'à 32 Ko, puis un huitième de puissance de deux) | en place (+4,4 % sur `data/`) | garder ; puissances de deux (cache mieux la taille, jusqu'à +100 %) ; 4 Ko partout | [v1.9](revues/v1.9.md) · PR #505 | en place, à confirmer |
| D33 | Quelle **bibliothèque Argon2id** dans l'appli ? | hash-wasm 4.12.0 (un mainteneur, 11,3 kB gzip) | garder ; libsodium-sumo (suivi actif, ≈ 195 kB gzip : pèse sur le budget de taille) | [v1.9](revues/v1.9.md) · PR #509 | en place, à confirmer |
| D35 | Le dépôt devient-il un **modèle** (« Template repository ») ? | non coché ; `data/` sur `main` | cocher après le passage à la branche `data` (D37) : un modèle sans données (#29) ; cocher tout de suite (le guide fait vider `data/`) ; ne pas cocher | [v2.0](revues/v2.0.md) · PR #522 | ouverte |
| D36 | L'assistant peut-il tout faire **depuis l'application** (Pages et phrase de passe) ? | deux gestes guidés dans GitHub | permission « Pages : écriture » au jeton : élargit le jeton ; écrire `DATA_PASSPHRASE` s'il n'existe pas : change PROJET.md § 7 ; garder | [v2.0](revues/v2.0.md) · PR #528 (#40) | en place, à confirmer |
| D36 bis | L'assistant en mode réel **depuis la démo d'un autre site**, et un lien de création de jeton pré-rempli ? | fermé | ouvrir (saisir son jeton sur le site de quelqu'un d'autre) ; garder fermé ; vérifier puis utiliser le lien pré-rempli | [v2.0](revues/v2.0.md) · PR #528 | ouverte |
| D39 | L'appli passe-t-elle sur son **origine à elle** (organisation Netatmodepoche), et décoche-t-on « Rester connecté » quand une trace d'un autre site est vue ? | transfert non fait ; avertissement seul | transférer (gestes de [l'étude](../etudes/origine-dediee.md)) : ferme #229 ; sous-domaine à soi ensuite (option A) ; décocher d'office | [v2.0](revues/v2.0.md) · PR #525, #229 | ouverte (la **destination** est tranchée par le propriétaire le 09/11/2026 : option B, organisation Netatmodepoche, « au moment de la v2.0 » ; [commentaire de #229](https://github.com/Opaland/Netatmo/issues/229#issuecomment-6752185197) ; le geste du transfert et « décocher d'office » restent) |
| D42 | La **page HTTP** de la copie locale garde-t-elle son lien vers la marche à suivre et sa démo désactivée ? | en place | garder ; pas de lien ; démo permise (impossible : elle déchiffre aussi, ce qui demande HTTPS) | [v2.0](revues/v2.0.md) · PR #531 | en place, à confirmer |
| D76 | Les réglages du foyer `STOPPED_ROOMS_JSON` et `WOOD_JSON`, lus en variables, **visibles dans les journaux publics** | relus en repli, avertissement dans le journal, dit dans SECURITY.md | les migrer en secrets depuis ⚙ Paramètres et supprimer les variables, puis effacer les anciens journaux (geste) ; retirer le repli des workflows (le collecteur garde la dernière liste) | [v2.4](revues/v2.4.md) · PR #574 (persona 28) | en place, à confirmer |
| D77 | Le **premier commit de la branche de #574** gardait des dates exactes (remplacées ensuite), encore lisible par la référence de la PR | rien | demander l'effacement au support de GitHub (seul à pouvoir le faire) ; l'accepter (des dates seules, sans valeur) | [v2.4](revues/v2.4.md) · § 7.0 | ouverte |
| D85 | `e2e-webkit-parcours` et `e2e-webkit` sont-ils **exigés** pour fusionner sur `main` ? | réglage non lisible depuis une session ; les jobs tournent sur chaque PR | les exiger (geste dans les réglages de GitHub) : un défaut WebKit bloque la fusion ; les laisser informatifs | [v2.6](revues/v2.6.md) · PR #608 | ouverte |
| D93 | Le collecteur se replie vers le **second hôte d'Intuis** même quand l'hôte a été choisi exprès | repli toujours, depuis #1 ; identifiants renvoyés au second hôte | garder ; ne se replier que depuis l'hôte par défaut (un serveur d'essai ne renvoie jamais les identifiants au vrai) : #649 n° 1 ; documenter `INTUIS_API_BASE` ; un test du repli | [v2.8](revues/v2.8.md) · § 12 n° 1 (persona 30) | en place, à confirmer |

## 2. Données : collecte, archive, audit

| # | La question | Aujourd'hui | Les options : ce que chacune débloque ou coûte | Posée par | État |
|---|---|---|---|---|---|
| D37 | Les données passent-elles sur une **branche `data`**, et `main/data` est-il vidé ? | rien n'est fait (variable absente) | passer (PR séparée, historique non réécrit) : débloque D35 et le modèle (#29) ; garder `main` ; réécrire l'historique (non prévu) | [v2.0](revues/v2.0.md) · PR #523 (#23) | ouverte |
| D37 bis | Un **rekey entre deux copies** de la branche est-il accepté ? | refusé, par prudence | accepter avec l'ancienne phrase en secret le temps du passage (`OLD_DATA_PASSPHRASE`) ; garder le refus | [v2.0](revues/v2.0.md) · PR #530 | en place, à confirmer |
| D37 ter | La garde anti-recul télécharge-t-elle **toute** la branche source ? | fetch complet (blobs compris) | `--filter=blob:none` après une mesure : plus rapide ; garder | [v2.0](revues/v2.0.md) · PR #530 | en place, à confirmer |
| D54 | Les **seuils de l'audit** marqués « hypothèse » (`ecart_absolu` 100 Wh, `jours_figes` 5…) | les valeurs des PR, chacune avec sa raison ; premier chiffre réel de `valeur-figee` : 2 cas (revue v2.4 § 10) | les valider sur le premier rapport réel (§ 9 des revues, geste) ; pour `valeur-figee` : ne regarder que la mesure, exclure les températures, ignorer une prise en veille | [v2.2](revues/v2.2.md) · PR #545, #547 | en place, à confirmer (D68 en a retiré deux faux positifs) |
| D55 | Combien de temps garder l'artefact `audit-donnees` ? | 7 jours | 1 jour (le temps de le télécharger) ; 30 jours ; garder | [v2.2](revues/v2.2.md) · PR #545 | en place, à confirmer |
| D56 | La **limite de 48 ko d'un secret** (plan de la maison) est-elle lue trop strictement ? | valeur scellée ≤ 48 ko, soit ≤ 36 816 octets | vérifier sur un dépôt d'essai (geste écrit dans #544) et relâcher à 48 ko si GitHub l'accepte : des plans plus grands ; garder | [v2.2](revues/v2.2.md) · PR #544 | en place, à confirmer |
| D60 | Le **journal public de l'audit** dit-il le mois de chaque cas ? | nombre de cas par contrôle et par mois | pour les contrôles « à vérifier », le total seulement (persona 31) ; garder | [v2.2](revues/v2.2.md) · § 7.0 | en place, à confirmer |
| D61 | Que comptent `verify` et l'export quand un jour est dans **deux fichiers d'année** ? | voir D67 | une vue « comme l'appli » ; tout passer par `own_year_first` | [v2.2](revues/v2.2.md) · § 6 n° 5, #550 | remplacée par D67 (#558 a mis une forme en place, revue v2.3 § 10) |
| D67 | `verify` et l'export comptent **comme l'appli**, et réimpriment les totaux par fichier quand ils diffèrent | en place (#558) | garder ; revoir les deux méthodes (`Store.totals`, `Store.file_totals`) | [v2.3](revues/v2.3.md) · PR #558, § 6 n° 1 | en place, à confirmer |
| D68 | `valeur-figee` : deux faux positifs retirés **sans seuil nouveau** | en place | après le premier rapport réel : ne regarder que la mesure, exclure les températures, relever `jours_figes` (5) | [v2.3](revues/v2.3.md) · PR #560 | en place, à confirmer |
| D70 | Si Intuis ne rend que des **totaux du mois** pour le chauffe-eau 2024, les répartit-on en jours « estimés » ? | rien n'est réparti | répartir (l'année redevient comparable, mais estimée) ; laisser « non mesuré » | [v2.4](revues/v2.4.md) · PR #572 | ouverte |
| D71 | Reprend-on la **courbe Linky** déjà rangée (2025-11 → 13/11/2026) avec la nouvelle lecture ? | non reprise ; l'appli le dit par jour | une commande dédiée, sur geste, avec sauvegarde, comparaison des totaux et `verify` (persona 46) ; ne rien reprendre. À décider **après** l'inventaire (revue v2.4 § 9) | [v2.4](revues/v2.4.md) · PR #573 | ouverte |
| D78 | Le texte d'un **jour de courbe sans marque** dit « a peut-être été rangé avec l'ancienne lecture » | la possibilité, pour tout jour sans marque d'avant le 13/11/2026 | garder ; l'affirmer pour les jours d'avant le 10/11/2026 ; ne garder que « à lire avec prudence » | [v2.5](revues/v2.5.md) · PR #586 | en place, à confirmer |

## 3. Calculs : ce qui est compté

| # | La question | Aujourd'hui | Les options : ce que chacune débloque ou coûte | Posée par | État |
|---|---|---|---|---|---|
| D4 | La **signature** est-elle en électricité + bois par défaut, et ses grilles (W/°C, kWh/m²/an) restent-elles indicatives ? | électricité + bois, bascule « Électricité seule » ; grilles au jugé, dites indicatives | garder ; électricité seule par défaut ; d'autres seuils de grille | [v1.8](revues/v1.8.md) · #460, PR #471 | en place, à confirmer |
| D5 | Calcule-t-on la part du **surplus solaire** absorbée par un chauffe-eau thermodynamique ? | non | une option « thermodynamique » dans `solar.ts` (énergie ÷ COP), COP saisi une fois ou ressaisi ; ne rien faire | [v1.8](revues/v1.8.md) · #453, PR #496 | ouverte |
| D6 | Le **COP** suit-il la température du local (sonde du garage ou de la cave) ? | COP fixe, saisi | choisir la sonde et une courbe COP(T) : plus juste, une saisie de plus ; garder fixe | [v1.8](revues/v1.8.md) · PR #496 | ouverte |
| D7 | La phrase sur les **légionelles** (« au moins 55 °C »), citée de mémoire, et le **COP proposé 2,5** | phrase en place ; 2,5 proposé | confirmer ou reformuler la phrase sur une source sanitaire ; garder 2,5, proposer 3, ou ne rien proposer | [v1.8](revues/v1.8.md) · PR #496 | en place, à confirmer |
| D8 | Le conseil « pièce du poêle au-dessus de 22 °C » : où, sur quelle fenêtre, gain sur quoi ? | page de la pièce ; 30 derniers jours de bois (7 au moins) ; gain sur la saison | ailleurs (carte du bois, Accueil) ; fenêtre sur la saison ou la période choisie ; gain sur la période seulement | [v1.8](revues/v1.8.md) · #468, PR #493 | en place, à confirmer |
| D12 | Un jour perdu **à égale distance de deux saisons** : la plus ancienne ou la plus récente ? | la première trouvée (`<`, `reconstitute.ts`) | garder ; prendre la plus récente ; figer le choix par un test (tue le survivant de mutation) | [v1.8](revues/v1.8.md) · #392, PR #494 | en place, à confirmer |
| D13 | Une pièce déclarée « Radiateurs retirés » perd son nom dans « Poêle à bois (Salon) » | compte comme pièce du poêle quand du bois est acheté (#455) | garder « poêle » et écrire « radiateurs retirés » dans la précision ; compter « retirés » partout comme pièce du poêle | [v1.8](revues/v1.8.md) · PR #443 | en place, à confirmer |
| D14 | Une pièce arrêtée : compte-t-elle comme arrêtée **dès la date déclarée** ou dès sa dernière donnée ? | inchangé (dernière donnée) | garder ; dès la date déclarée (change ce qui est calculé dans les comparaisons) | [v1.8](revues/v1.8.md) · PR #474 | ouverte |
| D15 | Utilise-t-on la **courbe Linky** pour dater un changement d'heures creuses tombé dans un trou ? | non | ouvrir une issue ; laisser | [v1.8](revues/v1.8.md) · PR #444 | ouverte |
| D21 | Saisit-on une **surface habitable** à part pour le repère kWh/m²/an ? | surface des pièces chauffées saisies | un champ « surface habitable » ; garder | [v1.9](revues/v1.9.md) · PR #510 | en place, à confirmer |
| D22 | Les **bornes des classes** de l'étiquette énergie sont-elles incluses en haut (A ≤ 70) ? | incluses | à confirmer sur le texte consolidé de Légifrance (lecture humaine) | [v1.9](revues/v1.9.md) · PR #510 | en place, à confirmer |
| D23 | Calcule-t-on l'**étiquette climat** (kg CO₂/m²/an) ? | non, dit à l'écran | la calculer (la classe officielle est la moins bonne des deux) ; garder | [v1.9](revues/v1.9.md) · PR #510 | ouverte |
| D24 | Quel **coefficient d'énergie primaire** de l'électricité : celui du jour ou celui de la période ? Et le 1,7 au 1/1/2027 ? | coefficient du jour ; 1,7 dès le 1/1/2027 | coefficient de la période du rapport (un rapport ne change plus de chiffre le 1er janvier) ; garder. Le 1,7 est à confirmer sur Légifrance | [v1.9](revues/v1.9.md) · PR #510 | en place, à confirmer |
| D26 | Dans **Mon défi**, la baisse d'une pièce arrêtée ou hors ligne compte-t-elle comme un progrès ? | non traitée à part | masquer le défi ; le dire ; partager l'objectif entre appareils | [v1.9](revues/v1.9.md) · PR #512 | ouverte |
| D27 | « **Ensoleillé** » : au-dessus de la médiane de tout l'historique ou du mois ? | médiane globale | médiane par mois (une deuxième règle) ; garder | [v1.9](revues/v1.9.md) · PR #507 | en place, à confirmer |
| D28 | Les **jours à 0 kWh du chauffe-eau** sont-ils écartés (année ramenée à 365 jours) ? | écartés, et c'est dit | les compter ; n'écarter que les coupures de 14 jours et plus ; garder. Ferme #502 | [v1.9](revues/v1.9.md) · #502, PR #508 | en place, à confirmer |
| D72 | Au-delà de quelle **part de jours manquants** une période est-elle écartée d'une comparaison ? | aucun seuil : un appareil n'est retiré que s'il n'a aucun relevé d'un côté | une part à fixer (un seuil qui change ce qui est calculé : à ne pas inventer) | [v2.4](revues/v2.4.md) · PR #574, choix 1 | ouverte |
| D73 | Une pièce dont le premier relevé suit **d'un jour** le début compte-t-elle comme ajoutée ? Et la tuile Hiver contre hiver ? | un jour ; total réduit à la portée comparée | une tolérance en jours ; garder le total entier et ne changer que le pourcentage | [v2.4](revues/v2.4.md) · PR #574, choix 2 et 4 | en place, à confirmer |
| D75 | La **projection de fin d'année** sur une année d'avant trouée en partie | non traitée | même règle que les comparaisons (`unmeasuredReasons`) ; la taire quand l'année d'avant est incomplète | [v2.4](revues/v2.4.md) · PR #574 | ouverte |
| D88 | La **pointe de la courbe à égalité** : première ou dernière demi-heure ? | la première, figée par un test (#628) | garder ; la dernière ; dire les deux ; ne pas figer | [v2.7](revues/v2.7.md) · PR #628 | en place, à confirmer |
| D89 | L'**ordre de deux trous identiques** (même début, même longueur, deux pièces) | non défini, non figé | par nom de pièce ; par cause ; les fondre en une ligne | [v2.7](revues/v2.7.md) · PR #630 | ouverte |
| D90 | Combien de **degrés-jours** pour dire « à climat égal » ? | 5 DJU pour un mois ; 50 pour une année ou une saison | garder ; un seuil proportionnel à la durée ; un seul seuil ; une phrase « trop peu de froid pour comparer » là où le calcul se tait | [v2.8](revues/v2.8.md) · PR #646 | en place, à confirmer |

## 4. Écrans et design

| # | La question | Aujourd'hui | Les options : ce que chacune débloque ou coûte | Posée par | État |
|---|---|---|---|---|---|
| D1 | L'**onglet actif sans gras** sur téléphone, pour que « Historique » tienne sans césure | pastille et couleur, sans gras | garder ; libellé plus petit (refusé par le plancher de taille) ; onglets inégaux | [v1.8](revues/v1.8.md) · #434, PR #445 | en place, à confirmer |
| D2 | Les **couleurs des tarifs** : heures pleines ardoise, heures creuses indigo | en place | garder ; une rampe d'encre avec un motif (deux lignes de `tokens.css`) | [v1.8](revues/v1.8.md) · #435, PR #447 | en place, à confirmer |
| D3 | Les **encres des séries** hors pièces et les tarifs ajustés | encres `--series-*` | garder ; appareil saisi hachuré ; ne pas exiger ΔE ≥ 20 entre encres et tarifs | [v1.8](revues/v1.8.md) · #446, PR #449 | en place, à confirmer |
| D25 | Les **paliers du défi** (−5, −10, −15 %) et la place de la carte (sous « Maintenant ») | en place ; −20 % retiré | garder ; d'autres paliers ; une autre place | [v1.9](revues/v1.9.md) · PR #512 | en place, à confirmer |
| D29 | Comment **découper Air et confort** (38 px de marge seulement) ? | explications repliées | des sous-pages comme l'Historique (recommandé par la PR) : ferme #498 ; chaque carte repliée ; continuer les replis | [v1.9](revues/v1.9.md) · #498, PR #514 | en place, à confirmer |
| D44 | La **forme des pièces** du plan | rectangles (une pièce en L = deux) | polygones ; poignées de redimensionnement au doigt | [v2.1](revues/v2.1.md) · PR #537, #539 | en place, à confirmer |
| D45 | Les **niveaux du plan** | cave, rez-de-chaussée, étage, fixes | combles ; second étage ; niveaux libres | [v2.1](revues/v2.1.md) · PR #537, #539 | en place, à confirmer |
| D46 | Le **dessin du plan prend le doigt** sur au plus un demi-écran | `touch-action: none` | un mode « Déplacer » à activer ; garder | [v2.1](revues/v2.1.md) · PR #539 | en place, à confirmer |
| D47 | L'**échelle de couleur** du plan | 5 paliers égaux, une échelle pour tous les niveaux | quantiles ; une échelle par niveau ; un autre nombre de paliers | [v2.1](revues/v2.1.md) · PR #537 | en place, à confirmer |
| D48 | Le **CO₂ sur le plan** (critère de #202) | non fait | une valeur « CO₂ » de plus, derrière le geste volontaire d'Air et confort ; pas de CO₂ sur le plan ; seulement les pièces de vie. Avec D49, ferme #202 | [v2.1](revues/v2.1.md) · PR #537, #539 | ouverte |
| D49 | Une **image de plan en fond** (critère de #202) | non faite (une image ne tient pas dans un secret) | un document chiffré dédié dans le dépôt ; renoncer. Avec D48, ferme #202 | [v2.1](revues/v2.1.md) · PR #537, #539 | ouverte |
| D50 | Une garde de **hauteur pour l'écran de déverrouillage en HTTP** (887 px à 360 × 740) ? | sans garde | une garde « 1,25 écran » dans `e2e/http.mjs` ; rien (écran vu une fois) | [v2.1](revues/v2.1.md) · PR #538 | ouverte |
| D52 | Replie-t-on davantage l'**assistant** de ⚙ Sources de données (~31 écrans à 200 %) ? | texte du jeton dit une fois | replier davantage ; replier la carte « 1. Autoriser… » quand il est ouvert ; garder | [v2.1](revues/v2.1.md) · PR #536 | en place, à confirmer |
| D57 | Garde-t-on le **lien pièce ↔ module de la station** dans l'éditeur du plan, pas encore lu ? | gardé, avec « pas encore lu » | le lire (colorer par CO₂ : dépend de D48) ; retirer le champ tant que D48 n'est pas tranchée | [v2.2](revues/v2.2.md) · PR #544 | en place, à confirmer |
| D58 | Les **lettres des appareils** deviennent des points quand elles dépasseraient 1,3 case (200 %) | points | des lettres plus grandes (couvraient les noms) ; un autre seuil | [v2.2](revues/v2.2.md) · PR #544 | en place, à confirmer |
| D59 | Le repli « délestage » du Compteur suit-il la préférence « tableaux ouverts » ? | il la suit | le sortir de la préférence | [v2.2](revues/v2.2.md) · PR #549 | en place, à confirmer |
| D63 | Sur l'Accueil, « Lire l'analyse complète » en **lien** au lieu d'un bouton (−20 px) | lien | revenir au bouton (marge 80 px au lieu de 100) ; trois pistes non faites pour plus de marge (revue v2.3 § 10) | [v2.3](revues/v2.3.md) · PR #563 | en place, à confirmer |
| D65 | « **Comparer** » en liste plutôt qu'en segment (Historique) | liste | garder le segment (marge 19 px) ; libellés plus courts ; si la liste est retenue : mettre à jour la maquette (#564 n° 3) | [v2.3](revues/v2.3.md) · PR #559 | en place, à confirmer |
| D66 | Plan à 200 %, étage : un **nom retiré** quand il n'a plus la place à côté d'une marque | nom retiré (la valeur reste) | déplacer la marque (elle ne dirait plus où est l'appareil) ; réduire la marque | [v2.3](revues/v2.3.md) · PR #560 | en place, à confirmer |
| D74 | La phrase des **pièces retirées** dans le verdict de l'Accueil | phrase complète dans la ligne | un renvoi court (« hors 2 appareils ») et la phrase dans « Comment c'est calculé » | [v2.4](revues/v2.4.md) · PR #574, choix 3 | en place, à confirmer |
| D79 | La **note d'un total incomplet** d'Année par année | l'usage non mesuré nommé ; les jours dits « pour » l'usage qui les manque | dire ce que compte « 366 jours manquants » ; compter l'usage non mesuré à part. #676 (v3.0) corrige l'accord de ce texte quand deux usages manquent, sans trancher | [v2.5](revues/v2.5.md) · PR #589 | en place, à confirmer |
| D81 | Les **tableaux de champs** (⚙ Sources, Air et confort) : colonne collante ou cartes ? | colonne collante ; listes longues tronquées dans leur boîte | des cartes (`cardTable`, rien de tronqué, plus haut : Air et confort a 38 px) ; laisser l'en-tête passer à la ligne ; ne plus coller quand la colonne prend plus de la moitié (persona 21) | [v2.6](revues/v2.6.md) · PR #607, #614 | en place, à confirmer (#614 corrigée en gardant la colonne collante, sans trancher : revue v2.6 § 13) |
| D82 | « **Pièces affichées** » se ferme quand le focus le quitte par Tab | fermé au départ du focus | le laisser ouvert et le déplacer hors du graphique ; le fermer seulement à Échap | [v2.6](revues/v2.6.md) · PR #607 | en place, à confirmer |
| D83 | Une attente annoncée (`role="status"`) **dans un résumé replié** | dans le résumé | sortir l'attente du résumé (la mise en page change) ; l'annoncer ailleurs | [v2.6](revues/v2.6.md) · PR #601 | en place, à confirmer |
| D97 | Le **bandeau hors ligne** recréé vide à chaque rendu, puis rempli | recréé à chaque vue ; peut clignoter et être réannoncé | garder ; garder le dernier texte d'un rendu à l'autre : plus de clignotement, une annonce seulement quand le texte change. Ferme #664 | [v2.9](revues/v2.9.md) · #664, PR #665 | en place, à confirmer |

## 5. Installation, copie locale, pont et IA

| # | La question | Aujourd'hui | Les options : ce que chacune débloque ou coûte | Posée par | État |
|---|---|---|---|---|---|
| D38 | La **copie locale** (NAS) : certificat, port, heure, `BRANCHE_DONNEES` | auto-signé à essayer ; 8080 ; 08:30 ; vide | un nom de domaine à soi ; d'autres réglages. Débloque #143 | [v2.0](revues/v2.0.md) · PR #527 | en place, à confirmer |
| D40 | Le **pont** local : go ou no-go, puis son architecture | aucune mesure, aucun go | mesurer 4 semaines d'hiver puis décider (ADR-7) : débloque #25 et le jalon « Matériel » (#282 à #285) ; abandonner le pont | [v2.0](revues/v2.0.md) · #25, #24 | ouverte |
| D41 | La **clé IA** (#14) : comment mesurer « synthèse lue 2 mois sur 3 » sans compteur ni pistage ? | aucune mesure | une case « lue » sur l'appareil ; un relevé déclaratif du propriétaire ; abandonner. Ferme #14 | [v2.0](revues/v2.0.md) · #14, ADR-5 | ouverte |
| D51 | Le **lien du guide** dans la copie du NAS | le dépôt d'origine, sauf `VITE_SOURCE_REPO` posée | le déduire de `DEPOT_URL` dans `copie-locale.sh` ; garder la variable | [v2.1](revues/v2.1.md) · PR #538 | en place, à confirmer |

## 6. Tests, CI et outils

| # | La question | Aujourd'hui | Les options : ce que chacune débloque ou coûte | Posée par | État |
|---|---|---|---|---|---|
| D31 | Une **étiquette `compatibilité`** pour les issues du gabarit ? | rangées sous `collecteur` | créer l'étiquette (réglage du dépôt) et changer le gabarit ; garder | [v1.9](revues/v1.9.md) · PR #516 | en place, à confirmer |
| D64 | L'**objectif de la garde de taille** passe-t-il de 80 % à 50 % du budget ? | 0.8 (inchangé) | 0,5 : 14,5 kB de marge à l'époque, une alerte plus tôt ; garder 0,8 | [v2.3](revues/v2.3.md) · PR #562 | ouverte |
| D80 | Hors de la police de la CI, les captures de référence : **dévier ou arrêter** ? | dévier (`screenshots-poste/`) et le dire | arrêter (bloque la porte de tout contributeur sans DejaVu Sans) ; dévier sur un poste, arrêter dans la CI | [v2.5](revues/v2.5.md) · PR #588, § 6 n° 4 | en place, à confirmer |
| D84 | Les **hauteurs en WebKit** sont-elles jugées, et avec quelles limites ? | mesurées, pas jugées | juger avec les limites de Chromium (elles tiennent aujourd'hui) ; une tolérance propre à WebKit | [v2.6](revues/v2.6.md) · PR #608 | en place, à confirmer |
| D86 | Quel **outil de mutation du collecteur** ? | `scripts/mutation_collecteur.py` (bibliothèque standard, à la main) | garder ; adopter `mutmut` (une dépendance de développement) ; ne rien garder | [v2.7](revues/v2.7.md) · PR #632 | en place, à confirmer |
| D87 | La **vague suivante de mutation** : quoi, et quand ? | la v3.0 (#678, #679) suit l'ordre de la feuille de route, proposé par son cadrage | `crypto.ts` et `periods.ts` en tête ; poursuivre `audit.py` ; `data-quality.ts` hors du lot ; garder l'ordre de la feuille de route. Débloque #634 n° 6 et #649 n° 4 | [v2.7](revues/v2.7.md) · PR #630, #632 | ouverte |
| D91 | Le **premier écran a pris 0,24 kB** en v2.8 (128,65 kB, 46 %) | rien de retiré | l'accepter comme référence ; charger `reloadApp` à la demande ; écrire « le total de la version » dans les cadrages (fait depuis le cadrage v2.9) | [v2.8](revues/v2.8.md) · PR #646 | en place, à confirmer |
| D92 | L'outil de mutation du collecteur compte-t-il un **code de sortie négatif** (signal) comme « tué » ? | « tué (signal) », dans le score | garder ; le compter « erreur » (un signal peut venir de la machine) ; le relancer une fois. Débloque #634 n° 3 | [v2.8](revues/v2.8.md) · PR #643 (persona 70) | en place, à confirmer |
| D94 | La **forme du découpage** d'`audit.py` et de `charts.ts` | le catalogue sorti (#661), rien d'autre | 1) `audit.py`, étape 2 : oui (proposé) / non ; 2) la classe `Audit` : ne pas la découper (proposé) / par familles / mixins ; 3) `charts.ts` : déplacements purs (proposé) / formes à la demande / rien ([étude](../etudes/decoupage-audit-charts.md)) | [v2.9](revues/v2.9.md) · PR #661 | en place, à confirmer |
| D95 | **Rééquilibrer les jobs e2e** de la CI, et leurs bornes | rien déplacé ; installations bornées à 10 min | garder ; le balayage et le clavier dans un sixième job (≈ 7 min de moins sur `e2e`, non exigé tant que le propriétaire ne l'ajoute pas) ; borne à 20 min. À revoir une fois l'effet du cache de #672 mesuré (revue de fin v3.0) | [v2.9](revues/v2.9.md) · PR #663 (#673 n° 2 et 3) | en place, à confirmer |
| D96 | Sur **macOS**, les captures ne vont jamais dans les références | toujours `screenshots-poste/` (#659) | garder (le cas sûr) ; revenir à l'avant | [v2.9](revues/v2.9.md) · PR #659 | en place, à confirmer |

## 7. Rangement des jalons

Ces décisions demandaient où ranger des issues **à la clôture** d'une version. Le rangement a été fait
par la PR de clôture ; ce qui reste à décider sur le fond est porté par D28, D29, D41, D48 et D49.

| # | La question | Aujourd'hui | Les options : ce que chacune débloque ou coûte | Posée par | État |
|---|---|---|---|---|---|
| D16 | Sortir #333 (et #364) du jalon v1.8 ; la revue de code par agent avant la clôture ou reportée | #333 et #364 au jalon « Matériel » ; la revue de code faite (revue v1.8 § 11 et § 12) | sortir / garder ; lancer / reporter | [v1.8](revues/v1.8.md) · § 3, § 4 | en place, à confirmer (« pour le seul rangement de #333 et #364 », revue v1.9 § 10) |
| D34 | Où ranger #139, #498, #502 à la clôture de la v1.9 ? | #139 au jalon « Matériel », #498 et #502 au jalon v2.0 | v2.0 ou « Matériel » | [v1.9](revues/v1.9.md) · § 3 | appliquée par #520 (clôture de la v1.9 ; revue v2.0 § 10) |
| D43 | Où ranger #14, #25, #29, #40, #143, #229, #498, #502 à la clôture de la v2.0 ? | fait | v2.1 ou « Matériel » | [v2.0](revues/v2.0.md) · § 3 | appliquée par #535 (« rangement du jalon, fait à la clôture de la v2.0 », revue v2.1 § 10) |
| D53 | Où ranger #202, #14, #498, #502 à la clôture de la v2.1 ? | passées au jalon v2.2 | #202 fermée si D48 et D49 sont tranchées, sinon v2.2 ; les autres en v2.2 ou « Matériel » | [v2.1](revues/v2.1.md) · § 3 | appliquée par #543 (« au jalon v2.2 », revue v2.2 § 10, D62) |
| D62 | Où ranger #202, #14, #498, #502 et #550 à la clôture de la v2.2 ? | sorties du jalon ; #550 en v2.3 (fermée) | une v2.3 à définir, ou « Matériel » pour #14 | [v2.2](revues/v2.2.md) · § 3 | appliquée par #552 (« sans jalon de version », revue v2.3 § 10, D69) |
| D69 | Où ranger #202, #14, #498, #502 à la clôture de la v2.3 ? | hors jalon de version depuis (revue v2.6 § 3) | une v2.4 à cadrer, ou « Matériel » pour #14 | [v2.3](revues/v2.3.md) · § 3 | sans objet (les quatre issues sont hors jalon, revue v2.9 § 3 ; le fond est D28, D29, D41, D48, D49) |

## 8. Index par numéro

D1 à D16 : [revue v1.8](revues/v1.8.md) ; D17 à D34 : [v1.9](revues/v1.9.md) ; D35 à D43 (et D36 bis,
D37 bis, D37 ter) : [v2.0](revues/v2.0.md) ; D44 à D53 : [v2.1](revues/v2.1.md) ; D54 à D62 :
[v2.2](revues/v2.2.md) ; D63 à D69 : [v2.3](revues/v2.3.md) ; D70 à D77 : [v2.4](revues/v2.4.md) ; D78 à
D80 : [v2.5](revues/v2.5.md) ; D81 à D85 : [v2.6](revues/v2.6.md) ; D86 à D89 : [v2.7](revues/v2.7.md) ;
D90 à D93 : [v2.8](revues/v2.8.md) ; D94 à D97 : [v2.9](revues/v2.9.md).

| Sujet | Numéros |
|---|---|
| 1. Sécurité, confidentialité, compte GitHub | D9, D10, D11, D17, D18, D19, D20, D30, D32, D33, D35, D36, D36 bis, D39, D42, D76, D77, D85, D93 |
| 2. Données | D37, D37 bis, D37 ter, D54, D55, D56, D60, D61, D67, D68, D70, D71, D78 |
| 3. Calculs | D4, D5, D6, D7, D8, D12, D13, D14, D15, D21, D22, D23, D24, D26, D27, D28, D72, D73, D75, D88, D89, D90 |
| 4. Écrans et design | D1, D2, D3, D25, D29, D44, D45, D46, D47, D48, D49, D50, D52, D57, D58, D59, D63, D65, D66, D74, D79, D81, D82, D83, D97 |
| 5. Installation, pont, IA | D38, D40, D41, D51 |
| 6. Tests, CI, outils | D31, D64, D80, D84, D86, D87, D91, D92, D94, D95, D96 |
| 7. Rangement des jalons | D16, D34, D43, D53, D62, D69 |

**Bilan au relevé** (100 lignes : les 97 numéros et les trois sous-décisions) : ouvertes 27 ; en place,
à confirmer 66 ; appliquées 5 ; remplacées 1 ; sans objet 1 ; tranchées par le propriétaire 0 (la
destination de D39 mise à part). Ces chiffres sont recomptés par `web/src/decisions.test.ts`.
