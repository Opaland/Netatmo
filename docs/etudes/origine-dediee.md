# Étude : donner à l'appli une origine web qui ne soit qu'à elle

*Statut : terminée, novembre 2026. Issue #229 (reste ouverte : la décision d'acheter un domaine
revient au propriétaire). Coût : de 0 € à une dizaine d'euros par an. Recommandation en fin de
document.*

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

Ce qui ne passe **pas** : un autre site ne peut pas enregistrer de service worker qui contrôle
`/<dépôt>/` (portée limitée au dossier de son script, et GitHub Pages n'envoie pas l'en-tête
`Service-Worker-Allowed`) ; la politique Trusted Types refuse un `sw.js` d'un autre chemin (#229).

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
organisation ; c'est une règle à se rappeler, pas une garantie technique. L'adresse change si le
dépôt bouge à nouveau, et GitHub ne redirige pas les adresses Pages après un transfert.

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

## Recommandation

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

## Sources (lues le 9 novembre 2026)

- MDN, [politique de même origine](https://developer.mozilla.org/fr/docs/Web/Security/Same-origin_policy)
  et [limites de stockage par origine](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- GitHub Docs, [domaine personnalisé pour GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site),
  [vérifier un domaine](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages),
  [types de sites Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages#types-of-github-pages-sites).
- W3C Service Workers, [portée et `Service-Worker-Allowed`](https://www.w3.org/TR/service-workers/#service-worker-script-response).
