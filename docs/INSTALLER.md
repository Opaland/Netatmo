# Installer l'historique pour votre foyer

Guide pas à pas pour un **nouveau foyer** : votre propre copie du dépôt, vos identifiants, vos
données. Comptez **15 à 30 minutes**, sans compter la première collecte qui remonte l'historique
(elle tourne seule sur GitHub). Rien n'est à installer sur un ordinateur : tout se fait dans le
navigateur, sur github.com.

Ce guide est la seule source des étapes d'installation ; le [README](../README.md) y renvoie. Les
options (station Netatmo, Linky, prises Shelly, IA…) restent décrites dans le README, section
« Options (facultatives) » : elles s'ajoutent après coup.

**Ce qu'il vous faut** : un compte GitHub (gratuit), le compte Intuis / Intuitiv de vos radiateurs
(e-mail et mot de passe de l'application mobile), un téléphone ou un ordinateur pour ouvrir le
résultat. Coût : aucun, tant que le dépôt est **public** (GitHub Pages et Actions sont gratuits pour
un dépôt public ; vos données y sont chiffrées, illisibles sans votre phrase de passe).

## 1. Créer votre dépôt

Sur la page du dépôt d'origine, bouton **Use this template → Create a new repository** :

- **Owner** : votre compte ; **Repository name** : au choix (il apparaîtra dans l'adresse du site) ;
- **Public** (voir ci-dessus) ;
- ne cochez pas « Include all branches ».

Le bouton n'apparaît que si le propriétaire a fait du dépôt un dépôt modèle (voir
[« Pour le propriétaire »](#pour-le-propriétaire--faire-du-dépôt-un-dépôt-modèle) en fin de guide).
S'il n'est pas là, **ne faites pas de « Fork »** : un fork n'exécute pas les tâches planifiées tant
qu'on ne les a pas activées une à une, et reste rattaché au dépôt d'origine. Utilisez plutôt
**Import repository** (`https://github.com/new/import`) avec l'adresse du dépôt d'origine : la copie
emporte aussi l'historique Git, ce qui ne gêne pas la suite.

Ce que la copie n'emporte **pas** : les secrets, les variables, les réglages de Pages, les issues.
Vous les créez ci-dessous.

## 2. Vider ce qui appartient au foyer d'origine

Votre copie contient le dossier `data/` du dépôt d'origine : l'historique **chiffré d'un autre
foyer**. Il ne s'ouvre pas avec votre phrase de passe, et la collecte s'arrêterait dessus (elle relit
`data/meta.enc.json` avec votre phrase avant d'écrire quoi que ce soit). Il faut donc le supprimer
**en entier**, `keyinfo.json` compris : la première collecte en recrée un, avec un sel neuf.

| À vider ou remplacer | Pourquoi | Comment |
|---|---|---|
| `data/` (tout le dossier) | données chiffrées d'un autre foyer | dans un clone (ou GitHub Codespaces) : `git rm -r data && git commit -m "Nouveau foyer : data/ vidé" && git push` ; sur github.com, si le menu `…` du dossier `data` propose **Delete directory**, c'est le même geste |
| `CHANGELOG.md`, `docs/bmad/`, `docs/design/` | l'histoire du projet d'origine, pas la vôtre | rien à faire : aucune donnée personnelle (captures de la **démo**, données fictives) ; à garder ou supprimer à votre goût |
| `SECURITY.md` | nomme le mainteneur du dépôt d'origine | à garder si vous restez sur ce code ; sinon, remplacer le contact par le vôtre |
| Réglages du dépôt (secrets, variables, Pages) | non copiés | étapes 4 et 5 |

Rien d'autre ne contient de donnée d'un foyer : la démonstration et les tests n'utilisent que des
données fictives, et les captures sont faites sur la démo.

## 3. Choisir une phrase de passe

Elle chiffre vos données. Prenez **au moins 5 mots** au hasard (ex. `pivoine tracteur lagune
moustache onze`) : le dépôt étant public, une phrase courte pourrait être devinée. Notez-la : sans
elle, les données sont perdues.

## 4. Ajouter les secrets

### Identifiants d'application

Le serveur Intuis demande, en plus de votre e-mail et de votre mot de passe, les identifiants OAuth
(`client_id` et `client_secret`) **de l'application mobile**. Ils ne sont délivrés à personne
officiellement. Les intégrations open source les incluent dans leur code, par exemple
[intuis-connect](https://github.com/antoine-pyre/intuis-connect) (fichier `const.py`). Ce dépôt ne les
contient pas : vous les ajoutez en secret.

### Les cinq secrets obligatoires

Dans votre dépôt : **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Valeur |
|---|---|
| `INTUIS_USERNAME` | e-mail du compte Intuis / Intuitiv |
| `INTUIS_PASSWORD` | mot de passe du compte |
| `INTUIS_CLIENT_ID` | voir « Identifiants d'application » |
| `INTUIS_CLIENT_SECRET` | voir « Identifiants d'application » |
| `DATA_PASSPHRASE` | votre phrase de passe (étape 3) |

### Autre voie : l'écran Paramètres de l'application

Une fois l'application ouverte (⚙ Paramètres → **Sources de données**), vous pouvez saisir vos
identifiants directement : l'application les **chiffre dans votre navigateur** avec la clé publique du
dépôt (le procédé imposé par GitHub) et les enregistre comme secrets, puis peut lancer la collecte.

Il faut pour cela un [jeton GitHub « fine-grained »](https://github.com/settings/personal-access-tokens/new) :
accès au seul dépôt, permissions **Secrets : lecture et écriture**, **Variables : lecture et écriture**
(pour lire puis supprimer les anciennes variables en clair en les migrant en secret : réglages du
foyer, contrat partagé, alerte froid) et **Actions : lecture et écriture**, rien d'autre, expiration
courte. Le jeton reste en mémoire le temps de la visite et l'application ne l'enregistre jamais. Les
champs du jeton et des identifiants ne sont pas dans un formulaire et sont marqués pour que le
navigateur et les gestionnaires de mots de passe courants ne proposent pas de les mémoriser ; aucun
navigateur ne le garantit : s'il le propose quand même, refusez. La phrase de passe des données ne se
change pas ici (README, « Changer de phrase de passe »).

## 5. Activer GitHub Pages

**Settings → Pages → Build and deployment → Source : GitHub Actions**.

## 6. Première collecte

**Actions → Collecte quotidienne → Run workflow**, en cochant **« Récupérer tout l'historique
disponible »**. La collecte remonte année par année tant que le serveur renvoie des données, puis
publie le site. Ensuite, elle tourne seule chaque nuit (vers 5 h-6 h, heure de Paris).

Si l'onglet **Actions** affiche d'abord un bouton « I understand my workflows, go ahead and enable
them », touchez-le : GitHub le demande sur certaines copies.

L'adresse du site s'affiche dans **Settings → Pages** (de la forme
`https://<utilisateur>.github.io/<dépôt>/`). Ouvrez-la, entrez votre phrase de passe : vos données
sont là.

## 7. Installer sur le téléphone

- **iPhone** : ouvrir l'adresse dans Safari → bouton Partager → **Sur l'écran d'accueil**.
- **Android** : ouvrir l'adresse dans Chrome → menu ⋮ → **Installer l'application**, ou le bouton
  **Installer l'application** de ⚙ Paramètres → À propos quand Chrome le propose.

La suite (mises à jour, invitation d'un membre du foyer, verrouillage, clé effacée par iOS) est dans
le README, « Sur le téléphone ».

## Vérifier que le dépôt est prêt (facultatif)

Pour qui a un clone et Python 3.12 (par exemple dans GitHub Codespaces, bouton **Code → Codespaces**) :

```bash
python scripts/depot_pret.py                         # data/ vidé ou à vous ? copie du dépôt d'origine ?
DATA_PASSPHRASE='votre phrase' python scripts/depot_pret.py   # + data/ s'ouvre avec votre phrase
python scripts/depot_pret.py --github moi/mon-depot  # + secrets obligatoires et Pages (avec `gh`, connecté)
```

Le script ne modifie rien. Il dit, point par point, **OK**, **À FAIRE** (avec le geste) ou
**À VÉRIFIER** (ce qu'il ne peut pas savoir seul), et sort en erreur s'il reste un « À FAIRE ». Il ne
lit jamais la valeur d'un secret : GitHub n'en donne que les noms.

## En cas de souci

- **La collecte s'arrête sur « Phrase de passe incorrecte ou fichier corrompu »** : `data/` contient encore des fichiers du
  foyer d'origine (étape 2), ou `DATA_PASSPHRASE` a changé depuis la première collecte.
- **« Secrets non configurés : … Collecte ignorée. »** dans le journal : un des secrets
  `INTUIS_USERNAME` ou `DATA_PASSPHRASE` manque (étape 4).
- **Le site affiche « Aucune donnée n'a encore été collectée »** : la première collecte n'est pas
  finie, ou Pages n'est pas réglé sur « GitHub Actions » (étape 5).
- Pour le reste : Paramètres → **État des sources** dans l'application, et le workflow
  **Diagnostic** (README, « Utilisation en local »).

---

## Pour le propriétaire : faire du dépôt un dépôt modèle

Un geste unique, qu'aucun agent ne fait à votre place (c'est un réglage du dépôt) :

1. Sur la page du dépôt : **Settings → General**.
2. Sous le nom du dépôt, cocher **Template repository**.

Effet : le bouton **Use this template** apparaît pour tout visiteur. Une copie faite ainsi part d'un
seul commit (sans votre historique Git), sans secrets, variables, issues ni réglages de Pages.

Ce que le réglage ne change pas, et qui reste à savoir avant de le cocher :

- la copie emporte **le contenu de `data/`** tel qu'il est au moment de la copie : vos fichiers
  **chiffrés**, déjà publics sur ce dépôt et illisibles sans votre phrase, mais recopiés chez chaque
  nouveau foyer (d'où l'étape 2). Un modèle sans données demanderait de ranger les données ailleurs
  (une branche à part, récit S-8.3) : décision d'architecture qui vous revient ;
- décocher la case retire le bouton ; les copies déjà faites restent indépendantes.
