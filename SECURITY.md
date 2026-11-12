# Signaler une faille

Ce dépôt est public, et l'application protège des données de consommation d'un foyer : chiffrées
(AES-256-GCM, clé dérivée de la phrase de passe), déchiffrées seulement dans le navigateur. Une
faille a donc du poids ici, même sans serveur ni compte.

## Comment la signaler

Par le **signalement privé de GitHub** : onglet **Security** du dépôt, puis
**Report a vulnerability**. Seul le mainteneur (@Opaland) lit ce que vous y écrivez.

Tant que ce bouton n'apparaît pas (son activation est un réglage du dépôt, laissé au mainteneur ;
le lien « Signaler une faille » de « New issue » ne sert qu'une fois ce réglage activé), ouvrez
une issue qui demande **seulement** un moyen de contact privé, sans aucun détail sur la faille :
ni composant visé, ni gravité, ni le mot « faille » dans le titre.

**Ne publiez jamais** dans une issue, une PR, un commentaire ou un journal : preuve de concept,
étapes pour reproduire, adresse de page piégée, phrase de passe, jeton, extrait de données
déchiffrées.

## Délais

Projet personnel, maintenu sur le temps libre : **aucun délai n'est promis**, ni pour l'accusé de
réception ni pour le correctif. Les signalements sont traités selon leur gravité (une fuite de
données en clair ou de secrets passe avant tout le reste) ; vous serez tenu au courant dans le
signalement privé, et cité dans la PR du correctif si vous le souhaitez.

## Périmètre

- **L'application** (`web/`) : déchiffrement local, clé « Rester connecté » (IndexedDB), notes
  chiffrées (localStorage), service worker et ses caches, politique de sécurité du contenu (CSP) et
  Trusted Types, appels à l'API GitHub depuis ⚙ Paramètres et l'assistant de premier lancement
  (aussi ouvert depuis l'écran d'un site sans données).
- **Le collecteur** (`collector/`) : appels à Intuis, Netatmo, Conso API, Shelly, Open-Meteo,
  Anthropic ; chiffrement avant commit ; journaux publics de GitHub Actions.
- **Les workflows** (`.github/workflows/`) : permissions, secrets, déploiement Pages et attestation
  de provenance.
- **Le chiffrement des données** (`data/*.enc.json`) : format d'enveloppe, dérivation de la clé.
- **La copie locale sur un NAS** (`scripts/nas/copie-locale/`) : script de synchronisation et
  serveur statique servis sur le réseau de la maison ; et les scripts d'installation
  (`scripts/depot_pret.py`, `scripts/donnees.sh`).

Hors périmètre : les services tiers eux-mêmes (Intuis, Netatmo, Enedis, GitHub…), et le partage
de l'origine `<compte>.github.io` entre les sites Pages d'un même compte, risque connu et documenté :
un script d'un autre site Pages du compte peut se servir de la clé « Rester connecté », lire ce qui
est tapé dans l'appli, et le site `<compte>.github.io` lui-même peut prendre la main durablement par
un service worker (README, section Sécurité ; [`docs/etudes/origine-dediee.md`](docs/etudes/origine-dediee.md)).
Le transfert vers une origine dédiée est décidé par le propriétaire (#229).

## Ce qui est déjà vérifié

Chaque point est tenu par un test qui échoue s'il est cassé :

- **Trusted Types** : tout HTML passe par la politique `energie`, le balisage exécutable est refusé,
  seul le service worker du site est accepté comme script — `web/src/trusted.test.ts` ; toute
  violation de la CSP pendant le parcours de la démo fait échouer `web/e2e/demo.mjs`.
- **Anti-clickjacking** : dans le cadre d'une autre page, aucun écran — `web/src/frame.test.ts`.
- **Enveloppes chiffrées** : format inconnu ou dérivation faible refusés avant tout calcul (#236) —
  `web/src/aggregate.test.ts`, `tests/test_collector.py`.
- **Journaux publics** : aucune valeur, aucun nom, aucun identifiant, aucun secret, même quand toutes
  les sources échouent — `tests/test_fuites.py`.
- **IA** : pièces et capteurs envoyés sous pseudonyme, jamais leurs noms —
  `tests/test_collector.py` (`test_insights_never_send_room_or_module_names`) et, sur la démonstration
  complète, `tests/test_promesses.py` (ni nom, ni jour daté hors des cinq jours inhabituels au plus).
- **Noms rangés sous le chemin de l'application** sur une origine partagée (#229) —
  `web/src/scope.test.ts` ; **trace d'un autre site de la même origine** signalée à côté de « Rester
  connecté » (détection, pas protection) — `web/src/origin-traces.test.ts`, et sur le site publié
  `web/e2e/en-ligne.mjs`.
- **« Recharger l'application »** n'efface ni la clé mémorisée, ni les notes, ni les données
  chiffrées gardées hors ligne, ni les caches d'un autre site du compte (#357) —
  `web/src/pwa.test.ts`, `web/e2e/pwa.mjs`.
