# Cadre juridique et conditions d'utilisation des services

> **Ceci n'est pas un avis juridique.** Cette page résume ce que le projet a lu des conditions
> d'utilisation des services qu'il appelle, et comment il les applique. Elle peut être incomplète ou
> dépassée : en cas de doute, lisez les textes eux-mêmes ou consultez un professionnel du droit.

Dernière revue : **9 novembre 2026** (S-8.14). La même information est résumée dans l'application,
menu ⋮ → Paramètres et connexions → **Cadre juridique** (fichier source : `web/src/legal.ts`, à mettre
à jour en même temps que cette page).

**Règle de revue** : à chaque revue de version (`docs/bmad/revues/vX.Y.md`), on relit les conditions de
chaque service et on met à jour la date de lecture ci-dessous. Une date de plus d'un an est signalée
« à relire » dans l'application.

## 1. Le cadre : un usage domestique de ses propres données

- Le projet sert **un foyer** à archiver **ses propres données** : sa consommation, sa météo, son
  compteur. Il n'est ni vendu, ni proposé comme service à des tiers, ni financé par la publicité.
- Chaque foyer installe sa propre copie (son dépôt GitHub, ses secrets, sa phrase de passe). Le code
  ne contient aucun identifiant de service ; personne d'autre que le foyer n'a accès à ses données.
- Les données sont **chiffrées** (AES-256-GCM) avant d'être écrites dans le dépôt, même public, et ne
  sont déchiffrées que dans le navigateur du foyer.

## 2. Services appelés, conditions et risque d'arrêt

| Service | Cadre | Conditions lues | Lu le | Risque d'arrêt |
|---|---|---|---|---|
| Intuis / Muller Intuitiv (radiateurs, chauffe-eau) | **API non officielle** : le serveur de l'application mobile, avec ses identifiants OAuth | Les CGU de l'application Intuitiv ne sont pas publiées sur [intuis.fr](https://www.intuis.fr) (on y trouve CGV, mentions légales, [politique de confidentialité](https://www.intuis.fr/politique-de-confidentialite)) : elles sont acceptées dans l'application à la création du compte, **à relire dans l'application** | 9 nov. 2026 | **Élevé** |
| Netatmo Connect (station météo) | API officielle, application créée par le foyer sur dev.netatmo.com | [Guidelines](https://dev.netatmo.com/guideline) et [Legal](https://dev.netatmo.com/legal) de Netatmo Connect ; l'usage commercial demande un accord ([partnerships@netatmo.com](mailto:partnerships@netatmo.com)). Pages dynamiques : texte complet à relire en ligne | 9 nov. 2026 | Faible |
| Conso API ([conso.boris.sh](https://conso.boris.sh)) → Enedis (Linky) | Service gratuit et open source qui relaie l'API Enedis réservée aux entreprises ; accord donné par le titulaire du contrat sur son compte Enedis | Pas de CGU publiées ; la page d'accueil indique : quotas Enedis partagés (5 requêtes/s, 10 000/h), blocage possible sans préavis en cas d'abus, aucune base de données (rien n'est stocké), serveurs européens, arrêt des anciennes API Enedis prévu vers mi-octobre 2026 | 9 nov. 2026 | Moyen |
| [Open-Meteo](https://open-meteo.com/en/terms) (météo de la commune) | API gratuite, sans compte | Usage **non commercial** uniquement (la domotique personnelle est citée comme admise) ; moins de 10 000 appels par jour ; données sous licence **CC BY 4.0** (attribution) | 9 nov. 2026 | Faible |
| CRE, via [data.gouv.fr](https://www.data.gouv.fr/datasets/historique-des-tarifs-reglementes-de-vente-delectricite-pour-les-consommateurs-residentiels) (tarifs réglementés) | Données publiques ouvertes | Licence indiquée sur la fiche du jeu de données (Licence Ouverte Etalab pour la plupart des jeux publics : **à confirmer sur la fiche**) | 9 nov. 2026 | Faible |
| [api-couleur-tempo.fr](https://www.api-couleur-tempo.fr) (couleurs Tempo) | API gratuite, sans compte | Pas de conditions trouvées ; à défaut, la couleur Tempo manque et seul le comparateur Tempo est touché | 9 nov. 2026 | Moyen |
| Anthropic (analyse IA, facultative) | API payante, clé du foyer | Conditions commerciales d'Anthropic, acceptées à la création de la clé sur console.anthropic.com ; non relues en détail pour cette page | 9 nov. 2026 | Faible |
| GitHub (dépôt, Actions, Pages) | Compte du foyer | Conditions de GitHub (non relues en détail pour cette page) ; un dépôt public expose le code et les fichiers **chiffrés**, jamais les secrets | 9 nov. 2026 | Faible |

### Intuis : ce qu'il faut savoir

- Intuis n'a pas d'API publique. Le collecteur utilise le même serveur et les mêmes identifiants
  d'application (`client_id`, `client_secret`) que l'application mobile, comme les intégrations
  Home Assistant existantes. Ces identifiants ne sont **pas** dans ce dépôt : chaque foyer les ajoute
  en secret. Détails techniques : [api-notes.md](api-notes.md).
- Ce n'est **ni autorisé ni interdit explicitement** à notre connaissance, faute de CGU publiques
  relues. Intuis peut changer ou couper l'accès à tout moment, et pourrait en théorie suspendre un
  compte dont l'usage lui paraît anormal.
- Ce que fait le projet pour limiter la charge et le risque : une collecte par nuit, un **plafond
  d'appels** par collecte (300 par défaut), une détection des changements de format qui arrête la
  collecte au lieu d'insister, aucune commande envoyée aux radiateurs (le collecteur ne fait que lire : inventaire, état, mesures).
- **Relevé horaire de l'état des pièces** (facultatif, S-13.2, variable `ROOM_STATE_HOURLY`) : il
  change le profil d'usage (24 lectures de `homestatus` par jour, 48 appels avec le jeton, en plus de
  la collecte nocturne). Il reste en lecture seule, plafonné à 4 appels par relevé et désactivé par
  défaut ; à couper si Intuis le demandait.
- **Si l'accès est coupé** : l'historique déjà collecté reste dans le dépôt, et la
  [sauvegarde chiffrée](../README.md#sauvegarde-chiffrée-hors-github) permet de le garder hors de
  GitHub. L'application continue d'afficher ce qui a été archivé.

## 3. Vie privée des membres du foyer (RGPD)

- Le RGPD ne s'applique pas, en principe, aux traitements faits par une personne **pour un usage
  strictement personnel ou domestique** (article 2.2.c, « exemption domestique »). Ce projet s'inscrit
  dans ce cadre tant qu'il reste à l'usage du foyer. **À vérifier** si l'usage change (logement loué,
  données d'un tiers, diffusion des chiffres).
- Même sans obligation, la consommation et les mesures par pièce révèlent des habitudes : heures de
  coucher, présence, chambre occupée. Le projet en tient compte :
  - **vue foyer** (S-12.2) : les chambres sont regroupées en « Chambres » sur tous les écrans
    (consommation, profils horaires, températures, CO₂ de la station) ; le détail s'affiche seulement
    sur un geste volontaire (menu ⋮), jusqu'au verrouillage suivant ;
  - **verrouillage** après inactivité et clé mémorisée 30 jours au plus (S-8.11) ;
  - **fenêtres ouvertes, boost, modes de consigne** (S-13.5) : seulement des heures **par pièce et
    par jour**, chiffrées ; les relevés horaires, chiffrés eux aussi, expirent après 3 jours et ne
    sont jamais commités ; la **présence** n'est pas lue, sauf option `ROOM_STATE_PRESENCE`
    (heures par jour, avec l'accord du foyer) ; chambres regroupées comme ailleurs ; rien n'est
    envoyé à l'IA. Analyse d'impact courte (finalité, durée, qui voit quoi) :
    [api-notes.md](api-notes.md#données-doccupation--analyse-dimpact-courte-s-135) ;
  - **IA** : seuls des totaux mensuels et les noms des pièces partent chez Anthropic ; l'application
    montre exactement ce qui a été envoyé. Choisir des noms de pièces neutres (« Chambre 1 » plutôt
    qu'un prénom) limite ce qui est transmis.
- Informez les membres du foyer de ce qui est archivé et de qui peut le lire (toute personne qui
  connaît la phrase de passe).

## 4. Accord Enedis et données Linky

- L'accès aux données Linky passe par l'**accord du titulaire du contrat**, donné dans son espace
  Enedis au profit de Conso API. Il est **révocable** à tout moment depuis la page
  [partage des données avec des tiers](https://mon-compte-particulier.enedis.fr/partage-donnees-tiers)
  de l'espace Enedis.
- Le jeton remis par Conso API est un secret GitHub ; seule une empreinte courte (chiffrée) est gardée
  pour suivre son expiration.
- La courbe de charge (demi-heures) n'est disponible que si le titulaire l'a activée chez Enedis ; elle
  est la donnée la plus révélatrice des habitudes du foyer et reste chiffrée comme le reste.

## 5. Licences des données ouvertes et attribution

- **Open-Meteo** : données sous CC BY 4.0, qui demande de citer la source. Open-Meteo est cité (avec
  un lien) dans le README, comme source de la météo dans l'écran Paramètres, et avec sa licence dans
  la page « Cadre juridique » de l'application.
- **CRE / data.gouv.fr** : jeux de données publics ; la source est citée dans le README et l'écran
  Paramètres. Licence à confirmer sur la fiche du jeu à chaque revue.
- **api-couleur-tempo.fr** : service gratuit, source citée dans le README.
- Le code de ce dépôt ne déclare pas encore de licence : sans licence, la réutilisation du code par
  d'autres n'est pas autorisée par défaut.

## 6. Ce que le projet s'interdit

- Revendre, publier ou partager les données d'un foyer.
- Embarquer dans le dépôt des identifiants d'application ou de compte.
- Contourner une limite technique (quota, blocage) : un blocage arrête la collecte de la source,
  qui reprend la nuit suivante.
- Proposer le collecteur comme service hébergé pour d'autres foyers.
