# Étude de l'existant et du marché (novembre 2026)

## Le besoin

L'application **Intuitiv with Netatmo / Intuis Connect** affiche la consommation des radiateurs et du
chauffe-eau (Aqua Manager) par jour, semaine et mois, mais :

- l'historique consultable est limité ;
- pas de comparaison d'une année sur l'autre ;
- pas d'export ;
- uniquement sur mobile.

## Ce qui existe déjà

| Projet | Type | Ce qu'il fait | Limites pour notre besoin |
|---|---|---|---|
| [intuis-connect](https://github.com/antoine-pyre/intuis-connect) | Intégration Home Assistant (Python, HACS), active | Pilotage, plannings, énergie par pièce, import de 2 ans d'historique | Nécessite un serveur Home Assistant ; comparaison N-1 limitée (voir plus bas) |
| [muller_intuis](https://github.com/tramsdale/muller_intuis) | Intégration Home Assistant | Climat, chauffe-eau, énergie chauffage / eau chaude séparées | Idem |
| [gladys-intuis](https://github.com/guim31/gladys-intuis) | Gladys Assistant (JS), très récent | Pièces, énergie | Box domotique requise, non testé sur matériel par l'auteur |
| [Flow Node-RED](https://flows.nodered.org/flow/3d7f77cef8a7c6aa4fc33e2dbf26f15e) / [Time-Planning-intuis](https://github.com/TheFab21/Time-Planning-intuis) | Node-RED + Home Assistant | Énergie journalière vers MQTT / statistiques HA | « Réservé aux experts », ne garde que la valeur du jour |
| [jeedom-plugin-mullerintuitiv](https://github.com/shun84/jeedom-plugin-mullerintuitiv) | Plugin Jeedom (PHP) | Températures, modes | Abandonné (2022), énergie non implémentée |
| Contrôleur HomeKit (Home Assistant) | Intégration native | Pilotage | Ni consommation ni plannings |

**Alternatives « foyer entier »** : Linky / Enedis ([ha-linky](https://github.com/bokub/ha-linky), Lixee,
applications fournisseurs, Ecojoko) donnent la consommation de toute la maison, jamais par pièce ni
séparément pour le chauffe-eau. Enedis conserve 2 à 3 ans de données.

**Tableau de bord Énergie de Home Assistant** : ne compare qu'avec la période immédiatement précédente ;
la comparaison avec l'année N-1 est une [demande récurrente](https://community.home-assistant.io/t/wth-why-can-i-only-compare-periods-in-the-energy-dashboard-with-the-previous-period/467189)
contournée par des cartes HACS.

## Positionnement de ce projet

Tous les projets existants **alimentent une box domotique**. Aucun ne propose :

- une **archive autonome sur plusieurs années**, qui survit aux limites de l'application ;
- **sans serveur à maintenir** (GitHub Actions + GitHub Pages, gratuit) ;
- **chiffrée** de bout en bout, déchiffrée seulement sur le téléphone ;
- une **comparaison d'années** (mois par mois, cumul, saison de chauffe) par pièce et
  séparément pour le chauffage et le chauffe-eau ;
- installable sur **Android et iPhone** comme une application (PWA), sans passer par les stores.

## Risques

- **API non officielle** : tous les projets utilisent les identifiants OAuth de l'application mobile,
  qui ne sont pas délivrés à des tiers. Aucune déclaration publique d'Intuis sur cet usage n'a été
  trouvée. À considérer comme toléré mais non autorisé : l'accès peut casser ou être coupé.
  Atténuation : appels peu nombreux (une collecte par jour), données déjà archivées conservées,
  possibilité de demander un accès officiel (contact-api@netatmo.com).
- **Évolutions de l'API** (types de mesure liés au tarif, changement d'URL) : détection automatique de
  la méthode de mesure et URL de secours.

## Distribution

- **PWA** : installation depuis le navigateur (Safari « Sur l'écran d'accueil », Chrome « Installer
  l'application »), mises à jour automatiques, fonctionne hors ligne.
- **Plus tard, si besoin** : la même PWA peut être publiée sur le Play Store via une TWA (Bubblewrap)
  et sur l'App Store via un conteneur (Capacitor), sans réécrire l'interface.
