# Étude : donner à l'appli une origine web qui ne soit qu'à elle

*Statut : terminée, novembre 2026, mise à jour le 12/11/2026 (v2.0). Issue #229 (reste ouverte
jusqu'au transfert). **Décision du propriétaire (9 et 10/11/2026)** : option B, l'organisation
GitHub **Netatmodepoche**, au moment de la v2.0 ; gestes exacts en fin de document. Coût : de 0 €
à une dizaine d'euros par an.*

## Situation

L'appli est servie sous `https://<compte>.github.io/<dépôt>/`. Pour le navigateur, l'**origine** est
`https://<compte>.github.io` : schéma + hôte + port, **sans le chemin**. Tout ce qui est rangé
« par site » l'est en fait par origine :

| Ce que garde le navigateur | Contenu pour cette appli |
|---|---|
| IndexedDB | la clé « Rester connecté » (CryptoKey non extractible, 30 jours au plus) |
| localStorage | notes chiffrées (factures, surfaces, travaux…), réglages en clair (prix saisis, budget, vue choisie, brouillon d'alerte froid), marque « clé gardée » |
| Cache API | fichiers chiffrés et tarifs publics, pour l'usage hors ligne |

Chaque **autre site GitHub Pages du même compte** (site perso `<compte>.github.io`, autre dépôt avec
Pages, fork d'un projet, démo) partage cette origine. Un script de ce site, ouvert dans le même
navigateur, peut donc :

1. **se servir de la clé mémorisée** : elle n'est pas copiable, mais `crypto.subtle.decrypt` l'accepte
   pour n'importe quel script de l'origine ; les fichiers `data/*.enc.json` étant publics, il peut
   déchiffrer l'historique et les notes ;
2. **lire et modifier** les réglages en clair et les notes (chiffrées, donc illisibles sans la clé,
   mais effaçables) ;
3. **ouvrir l'appli** dans une fenêtre (`window.open('/<dépôt>/')`) et, même origine oblige, lire sa
   page et ce qui y est tapé, **phrase de passe comprise**. Ce point vaut aussi sans « Rester
   connecté ».

4. **prendre la main sur l'appli, durablement**, par un service worker. *(Corrigé le 12/11/2026 :
   la version précédente de cette étude disait que cela ne passait pas.)* Un site de **dépôt**
   (`/<autre>/sw.js`) ne peut pas viser `/<dépôt>/` : sa portée s'arrête à son dossier et GitHub
   Pages n'envoie pas l'en-tête `Service-Worker-Allowed`. Mais le **site du compte lui-même** (dépôt
   `<compte>.github.io`, servi à la racine) peut enregistrer `/sw.js` avec la portée `/`, qui couvre
   `/<dépôt>/` ; et tout script de l'origine peut **désinscrire** le service worker de l'appli
   (`navigator.serviceWorker.getRegistration('/<dépôt>/')` puis `unregister()`). Le service worker
   racine sert alors les pages de l'appli comme il veut, **à chaque ouverture suivante**, même après
   la fermeture du site hostile, jusqu'à ce que le navigateur l'oublie.

Ce que l'appli peut encore refuser chez elle : la politique Trusted Types n'accepte qu'un `sw.js`
au chemin exact de l'appli (#229) ; elle ne protège pas d'un service worker enregistré par une
**autre page** de l'origine.

Le risque suppose qu'un autre site Pages **du même compte** devienne hostile (dépendance
compromise, page de test oubliée, contribution malveillante acceptée sur un autre dépôt). Il est
faible tant que le compte ne publie que cette appli, mais il n'est pas nul et il ne se voit pas.

## Ce qui est déjà fait sur l'origine actuelle (v1.5)

- Noms rangés sous le chemin : `intuis-history@<dépôt>:…` dans localStorage, base IndexedDB
  `intuis-history@<dépôt>`, caches `energy-data@<dépôt>` (`web/src/scope.ts`, `web/vite.config.ts`).
  Une autre copie de l'appli publiée sur le même compte n'ouvre plus la clé de celle-ci **par
  mégarde**. Ce n'est **pas** une isolation : un script hostile peut lister et ouvrir n'importe quel nom.
- Les anciennes valeurs sont reprises sous les nouveaux noms ; la clé mémorisée sous l'ancien nom est
  **oubliée** (la phrase de passe est redemandée une fois après la mise à jour).
- Service worker : seul `sw.js` **au chemin exact** de l'appli est accepté comme script.
- Avertissement dans Paramètres (« Ce qui est public ») et dans le README (Sécurité).
- **v2.0 : la règle se vérifie sur l'appareil** (`web/src/origin-traces.ts`). Sur `*.github.io`,
  l'écran de déverrouillage regarde ce que le navigateur garde pour l'origine (clés de
  localStorage, bases IndexedDB, caches, service workers) ; tout nom qui n'est pas celui de l'appli
  est la trace d'un autre site du compte ouvert dans ce navigateur, et un avertissement s'affiche à
  côté de « Rester connecté ». C'est une détection, pas une protection : un script hostile peut
  effacer ses traces, et un site jamais ouvert ici n'en laisse pas. Rien n'est effacé (ce peut être
  le site du propriétaire).

### Pistes écartées dans le code (elles n'atténuent rien de réel)

- **CSP limitée au chemin** (`script-src https://<compte>.github.io/<dépôt>/` au lieu de `'self'`) :
  elle ne s'applique qu'aux pages de l'appli. Le danger est un script d'une **autre** page de
  l'origine, que cette CSP ne voit pas ; et chez elle, l'appli n'injecte aucun script (Trusted Types
  refuse tout balisage exécutable). Elle forcerait en plus le nom du compte dans le build.
- **Portée du service worker** : elle est déjà le dossier de l'appli (`/<dépôt>/`), le plus juste
  possible ; une portée plus étroite laisserait des pages hors ligne sans rien protéger.
- **Contrôler le service worker qui sert la page** depuis le JavaScript de l'appli : si la page est
  servie par un service worker hostile, ce JavaScript est le sien ; le contrôle ne prouve rien.
- **Décocher « Rester connecté » d'office** quand une trace est vue : possible et sans risque, mais
  c'est un choix de produit (confort au quotidien) : proposé au propriétaire, pas fait.

Seule une origine propre supprime le partage. Trois façons d'y arriver.

## Option A : domaine (ou sous-domaine) personnel sur GitHub Pages

L'appli devient par exemple `https://energie.mondomaine.fr/`, origine qui n'appartient qu'à elle.

**Coût** : un domaine `.fr`, `.eu` ou `.net` coûte de l'ordre de **7 à 15 € par an** chez un
bureau d'enregistrement courant (OVHcloud, Gandi, Infomaniak…, prix à vérifier au moment de
l'achat). Gratuit si le foyer possède déjà un domaine : un sous-domaine suffit. GitHub Pages et le
certificat HTTPS (Let's Encrypt) restent gratuits.

**Étapes** (une demi-heure, plus l'attente DNS) :

1. Acheter le domaine. Dans la zone DNS, créer `energie  CNAME  <compte>.github.io.`
   (sous-domaine ; pour un domaine nu, les enregistrements `A`/`AAAA` de la documentation GitHub).
2. GitHub → *Settings* du **compte** → *Pages* → **Vérifier le domaine** (enregistrement `TXT`) :
   empêche un autre compte de s'en emparer si Pages est un jour désactivé.
3. Dépôt → *Settings* → *Pages* → *Custom domain* : `energie.mondomaine.fr`, puis **Enforce HTTPS**
   une fois le certificat émis. Avec un déploiement par Actions, le fichier `CNAME` n'est pas
   nécessaire.
4. Ouvrir la nouvelle adresse sur chaque appareil, réinstaller l'icône (une PWA est liée à son
   origine), retaper la phrase de passe. Les notes et réglages de l'ancienne origine **ne suivent
   pas**, et l'ancienne adresse redirigera vers la nouvelle : **avant** l'étape 3, noter ou exporter
   ce qui a été saisi (factures, surfaces, travaux, volets en CSV), puis le ressaisir.
5. Mettre à jour l'invitation (QR code construit depuis l'adresse ouverte : rien à changer dans le
   code) et le lien du README.

**Points d'attention**

- `https://<compte>.github.io/<dépôt>/` **redirige** alors vers le domaine : l'ancienne adresse reste
  utilisable comme lien, pas comme origine.
- Si le **site utilisateur** `<compte>.github.io` a lui-même un domaine personnel, les sites de dépôt
  **sans** domaine propre sont servis sous ce domaine-là : c'est bien le domaine **du dépôt** qu'il
  faut régler.
- Renouveler le domaine chaque année (renouvellement automatique) : un domaine expiré peut être
  racheté par un tiers, qui hériterait de l'origine.
- Bonus : l'origine ne dépend plus de GitHub. Si l'hébergement change un jour, les clés et notes des
  appareils restent en place.

## Option B : compte ou organisation GitHub dédiés

Transférer le dépôt dans une **organisation** gratuite (ou un second compte) qui ne publie **que**
cette appli : origine `https://<organisation>.github.io`.

**Coût** : 0 €. **Étapes** : créer l'organisation, *Transfer ownership* du dépôt, vérifier que les
secrets, variables et l'environnement Pages ont suivi (à revérifier après transfert, les ressaisir
au besoin), réactiver Pages. Comme pour A, nouvelle origine : réinstaller, retaper la phrase.

**Limites** : l'isolation tient **tant que personne ne publie d'autre site Pages** dans cette
organisation ; c'est une règle à se rappeler, pas une garantie technique. Le pire cas est un dépôt
`<organisation>.github.io` : servi à la racine, il peut prendre la main durablement par un service
worker (point 4). L'adresse change si le dépôt bouge à nouveau, et GitHub ne redirige pas les
adresses Pages après un transfert (à vérifier le jour du transfert). La détection de l'appareil
(`origin-traces.ts`) continue de signaler une trace d'un autre site dans l'organisation.

## Option C : rester sur l'origine partagée, sans « Rester connecté »

**Coût** : 0 €, rien à faire. La clé n'est jamais gardée : un autre site ne peut plus s'en servir
**plus tard**, à froid. Restent : les réglages en clair lisibles, les notes effaçables, et le point 3
(une page hostile du même compte peut ouvrir l'appli et lire la phrase tapée). Inconfort : la phrase
à chaque ouverture, ce que « Rester connecté » (S-8.11) cherchait justement à éviter sur téléphone.

## Comparaison

| | A. Domaine dédié | B. Organisation dédiée | C. Sans « Rester connecté » |
|---|---|---|---|
| Origine propre | **oui** | oui, si rien d'autre n'y est publié | non |
| Clé mémorisée hors d'atteinte | **oui** | oui (même condition) | pas de clé gardée |
| Phrase tapée hors d'atteinte | **oui** | oui (même condition) | **non** |
| Coût | 7 à 15 €/an (0 € avec un domaine existant) | 0 € | 0 € |
| Travail | 30 min + DNS, renouvellement annuel | 30 min, vérifier secrets | aucun |
| Adresse stable si l'hébergement change | **oui** | non | non |
| Confort au quotidien | inchangé | inchangé | phrase à chaque ouverture |

## Recommandation de l'étude (9/11/2026), puis décision

**Option A, avec un sous-domaine** (`energie.<domaine du foyer>`) : c'est la seule qui donne une
origine propre **garantie par la technique** plutôt que par une règle, elle garde « Rester
connecté » et elle survit à un changement d'hébergeur. Si le foyer a déjà un domaine, elle est
gratuite ; sinon une dizaine d'euros par an.

En attendant la décision :

- ne publier **aucun autre site GitHub Pages** sur le compte (ni site perso, ni démo, ni fork avec
  Pages activé) ;
- sur un appareil partagé ou si un autre site Pages existe déjà sur le compte, **ne pas cocher**
  « Rester connecté ».

Si l'achat d'un domaine est écarté, **l'option B** donne le même résultat gratuitement, au prix d'une
discipline à tenir (rien d'autre publié dans l'organisation).

**Décision du propriétaire** (commentaires de #229, 9 et 10/11/2026) : **option B**, organisation
**Netatmodepoche** ; l'appli sera servie sous `https://netatmodepoche.github.io/Netatmo/`. Règles :
aucun autre site Pages dans cette organisation, et **pas de dépôt `netatmodepoche.github.io`**.
L'option A (sous-domaine) reste possible plus tard, par-dessus B, sans autre transfert.

## Le transfert vers Netatmodepoche : gestes exacts du propriétaire

Rien de ceci n'est fait par un agent : chaque geste touche le compte, l'organisation ou les
appareils. Ordre conseillé, un jour sans collecte en cours (après 05:00 UTC).

**Avant**

1. Sur chaque appareil : Outils → Exporter mes données → **Télécharger une sauvegarde chiffrée**, et
   noter ce qui n'est gardé que sur l'appareil (factures, surfaces, travaux, absences, réglages) :
   la nouvelle origine **ne le reprend pas**. Noter les totaux de l'année.
2. Relever la liste des secrets et variables du dépôt (Settings → Secrets and variables → Actions) :
   noms seulement, pour vérifier après le transfert.
3. Vérifier que l'organisation **Netatmodepoche** n'a aucun autre dépôt avec Pages, ni de dépôt
   `netatmodepoche.github.io`.

**Le transfert**

4. Dépôt → Settings → General → *Danger Zone* → **Transfer ownership** → Netatmodepoche, nom
   inchangé (`Netatmo`).
5. Dans le dépôt transféré : Settings → Pages → *Source* : **GitHub Actions** ; Settings → Actions →
   General : workflows autorisés, et *Workflow permissions* qui laissent les workflows demander
   l'écriture (la collecte commite ; un réglage d'organisation peut l'interdire) ; environnement
   `github-pages` présent. Comparer secrets et variables à la liste de l'étape 2,
   ressaisir ce qui manque.
6. Lancer **Actions → Déploiement GitHub Pages**, puis **Actions → Collecte quotidienne** à la main :
   le résumé du déploiement donne l'adresse `https://netatmodepoche.github.io/Netatmo/`.

**Ce qui nomme l'ancien compte** (une PR après le transfert ; GitHub redirige les adresses de
dépôt, pas celles de Pages) :

- `scripts/nas/volets.sh` (`DEPOT='Opaland/Netatmo'`) et, sur le NAS, la variable `DEPOT` ; le jeton
  à accès fin du NAS (*Only select repositories*) est à recréer sur le dépôt transféré
  (`docs/etudes/volets-wiser.md`) ;
- les liens du README (`SITE=https://opaland.github.io/Netatmo`, `gh attestation verify -R …`),
  `SECURITY.md`, `.github/ISSUE_TEMPLATE/config.yml`, `web/src/legal.ts`, le dépôt par défaut de
  `web/src/views/settings.ts`, les `User-Agent` du collecteur (`collector/enedis.py`, `shelly.py`,
  `scripts/tempo_jours.py`), `scripts/revue_issues.py` ;
- les tests qui citent l'adresse comme exemple peuvent rester (données fictives).

**Après, sur chaque appareil**

7. Ouvrir la nouvelle adresse, **réinstaller l'icône** (une PWA est liée à son origine), retaper la
   phrase de passe, ressaisir les notes de l'étape 1. Vérifier les totaux.
8. Sur l'ancienne adresse : rien à garder. Paramètres → *Recharger l'application* puis effacer les
   données du site `opaland.github.io` dans le navigateur, si aucun autre site de ce compte n'y sert.
9. Fermer #229.

## Sources (lues le 9 novembre 2026)

- MDN, [politique de même origine](https://developer.mozilla.org/fr/docs/Web/Security/Same-origin_policy)
  et [limites de stockage par origine](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- GitHub Docs, [domaine personnalisé pour GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site),
  [vérifier un domaine](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages),
  [types de sites Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages#types-of-github-pages-sites).
- W3C Service Workers, [portée et `Service-Worker-Allowed`](https://www.w3.org/TR/service-workers/#service-worker-script-response).
