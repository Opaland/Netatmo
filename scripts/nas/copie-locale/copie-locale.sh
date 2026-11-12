#!/bin/sh
# Copie locale de l'application et des données chiffrées, sur le NAS (issue #143).
#
#   copie-locale.sh synchro   récupère la dernière version du dépôt (clone ou fetch, en lecture seule),
#                             reconstruit l'application si web/ a changé, puis publie une nouvelle
#                             copie (application + data/) ; la précédente reste servie en cas d'échec
#   copie-locale.sh boucle    synchro, puis attend l'heure suivante HEURE, à l'infini (le conteneur)
#   copie-locale.sh attente   nombre de secondes jusqu'à la prochaine HEURE (pour vérifier le réglage)
#
# Sortant seulement : git (HTTPS vers le dépôt public, sans jeton) et npm (registre des paquets) ;
# aucun port n'est ouvert par ce script. Aucun secret : l'URL du dépôt est refusée si elle en porte un,
# et les données restent chiffrées (elles ne sont jamais déchiffrées ici).
#
# Réglages (variables d'environnement, voir docker-compose.yml) :
#   DEPOT_URL   dépôt à copier (défaut : le dépôt public d'origine)
#   BRANCHE     branche (défaut : main)
#   BRANCHE_DONNEES  branche où vivent les données chiffrées quand le dépôt a la variable DATA_BRANCH
#               = data (#23, README « Branche des données ») ; vide : le data/ de BRANCHE
#   HEURE       heure locale de la synchro quotidienne, HH:MM (défaut : 08:30, après la collecte
#               de la nuit et son déploiement) ; TZ donne le fuseau (défaut du conteneur : UTC)
#   COPIE       dossier de travail (défaut : /copie) : depot/, constructions/, site/
#   GARDER      nombre de copies publiées gardées (défaut : 3)
#   CONSTRUIRE  commande de construction lancée dans web/ (défaut : npm ci puis npm run build)
#   COPIE_MAINTENANT  (tests seulement) l'heure, en secondes depuis 1970, au lieu de l'horloge
set -u
umask 022

DEPOT_URL=${DEPOT_URL:-https://github.com/Opaland/Netatmo.git}
BRANCHE=${BRANCHE:-main}
BRANCHE_DONNEES=${BRANCHE_DONNEES:-}
HEURE=${HEURE:-08:30}
COPIE=${COPIE:-/copie}
GARDER=${GARDER:-3}
CONSTRUIRE=${CONSTRUIRE:-npm ci --no-audit --no-fund && npm run build}

# The clock. COPIE_MAINTENANT replaces it in the tests only (a `date` placed earlier in PATH is not
# enough: a busybox shell may run its own applet, docs/APPRENTISSAGES.md A11).
maintenant() {
	if [ -n "${COPIE_MAINTENANT:-}" ]; then
		printf '%s\n' "$COPIE_MAINTENANT"
	else
		date +%s
	fi
}

# The log goes to stderr (the container's log): stdout carries the values functions return.
journal() {
	printf '%s copie-locale : %s\n' "$(date -u -d "@$(maintenant)" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u)" "$1" >&2
}

die() {
	journal "$1"
	exit "${2:-1}"
}

verifier_reglages() {
	case "$DEPOT_URL" in
	https://*@* | http://*@*) die "DEPOT_URL contient un identifiant : le dépôt est public, aucun jeton n'est nécessaire" 2 ;;
	https://* | file://* | /*) ;;
	*) die "DEPOT_URL doit commencer par https:// (dépôt public)" 2 ;;
	esac
	case "$BRANCHE" in
	'' | -* | *[!A-Za-z0-9._/-]*) die "BRANCHE invalide" 2 ;;
	esac
	case "$BRANCHE_DONNEES" in
	-* | *[!A-Za-z0-9._/-]*) die "BRANCHE_DONNEES invalide" 2 ;;
	esac
	case "$GARDER" in
	'' | *[!0-9]* | 0) die "GARDER doit être un entier ≥ 1" 2 ;;
	esac
	heure_en_minutes >/dev/null || die "HEURE doit être de la forme HH:MM (00:00 à 23:59)" 2
}

# HEURE as minutes since midnight; fails on anything but HH:MM.
heure_en_minutes() {
	case "$HEURE" in
	[0-2][0-9]:[0-5][0-9]) ;;
	*) return 1 ;;
	esac
	h=${HEURE%:*} m=${HEURE#*:}
	h=${h#0} m=${m#0}
	[ "${h:-0}" -le 23 ] || return 1
	printf '%s\n' $((${h:-0} * 60 + ${m:-0}))
}

# Seconds until the next HEURE in local time (TZ), 1 to 86400: at HEURE exactly, the next day.
attente() {
	cible=$(heure_en_minutes) || return 1
	now=$(maintenant)
	# local seconds since midnight, from the local clock (handles TZ and summer time)
	hms=$(date -d "@$now" +%H:%M:%S) || return 1
	h=${hms%%:*} rest=${hms#*:}
	m=${rest%%:*} s=${rest#*:}
	depuis=$(((${h#0} + 0) * 3600 + (${m#0} + 0) * 60 + (${s#0} + 0)))
	reste=$((cible * 60 - depuis))
	[ "$reste" -gt 0 ] || reste=$((reste + 86400))
	printf '%s\n' "$reste"
}

# The repository, read-only: shallow clone the first time, then fetch and align on the branch.
# Local changes are impossible to keep (and never expected): the working copy is the branch.
recuperer() {
	depot="$COPIE/depot"
	if [ ! -d "$depot/.git" ]; then
		rm -rf "$depot.tmp"
		git clone --quiet --depth 1 --branch "$BRANCHE" --single-branch -- "$DEPOT_URL" "$depot.tmp" ||
			return 1
		mv "$depot.tmp" "$depot"
	else
		git -C "$depot" remote set-url origin "$DEPOT_URL" &&
			git -C "$depot" fetch --quiet --depth 1 origin "+refs/heads/$BRANCHE:refs/remotes/origin/$BRANCHE" &&
			git -C "$depot" reset --quiet --hard "origin/$BRANCHE" &&
			git -C "$depot" clean --quiet -fdx || return 1
		# a shallow fetch each night leaves the previous data behind: about 10 MB a day, dropped here
		git -C "$depot" reflog expire --expire=now --all &&
			git -C "$depot" gc --quiet --prune=now || journal "nettoyage git impossible (non bloquant)"
	fi
	# #23: the data in a branch of its own (data/ alone), fetched beside the code, never checked out
	if [ "$(source_donnees)" != HEAD ]; then
		git -C "$depot" fetch --quiet --depth 1 origin "+refs/heads/$BRANCHE_DONNEES:refs/remotes/origin/$BRANCHE_DONNEES" ||
			return 1
	fi
}

# The commit data/ is read from: the data branch when there is one, else the code's own commit.
source_donnees() {
	if [ -n "$BRANCHE_DONNEES" ] && [ "$BRANCHE_DONNEES" != "$BRANCHE" ]; then
		printf '%s\n' "origin/$BRANCHE_DONNEES"
	else
		printf '%s\n' HEAD
	fi
}

# Keeps, in folder $1, the entry $2 (the one just made) and the GARDER-1 most recent others. $2 is
# never a candidate: the order comes from modification times, and two entries made in the same
# instant (coarse clock) sort either way; on the CI runner, the build just made was removed.
elaguer() {
	ls -1t "$1" | grep -v '\.tmp$' | grep -vxF "$2" | awk -v n=$((GARDER - 1)) 'NR > n' | while read -r vieux; do
		rm -rf "${1:?}/$vieux"
	done
}

# Builds the app once per source tree, in the repository's own web/ (the build reads files outside
# web/, such as docs/export-long.schema.json: a copy of web/ alone does not build). The build is named
# after every top-level entry of the commit except data/, so the nightly data commits reuse the last
# build. Prints the build folder.
construire() {
	depot="$COPIE/depot"
	arbre=$(git -C "$depot" ls-tree HEAD | grep -v "$(printf '\t')data\$" | git hash-object --stdin) || return 1
	sortie="$COPIE/constructions/$arbre"
	if [ -f "$sortie/index.html" ]; then
		printf '%s\n' "$sortie"
		return 0
	fi
	rm -rf "$sortie.tmp" "$depot/web/dist"
	mkdir -p "$COPIE/constructions" || return 1
	journal "construction de l'application (sources ${arbre%"${arbre#???????}"})"
	ok=1
	(cd "$depot/web" && sh -c "$CONSTRUIRE") >&2 || ok=0
	if [ "$ok" = 1 ] && [ ! -f "$depot/web/dist/index.html" ]; then
		journal "la construction n'a pas produit dist/index.html"
		ok=0
	fi
	# touch: a rename keeps the build's own mtime, the pruning below sorts on it
	[ "$ok" = 1 ] && mv "$depot/web/dist" "$sortie.tmp" && mv "$sortie.tmp" "$sortie" && touch "$sortie" || ok=0
	# the npm packages (about 300 MB) are not kept between builds; the next fetch cleans the rest
	rm -rf "$depot/web/node_modules" "$depot/web/dist"
	[ "$ok" = 1 ] || return 1
	# only the last builds are kept (each takes a few MB)
	elaguer "$COPIE/constructions" "${sortie##*/}"
	printf '%s\n' "$sortie"
}

# A new published copy: the build, plus data/ as the deploy workflow adds it (only when the
# repository has data: keyinfo.json), then the « actuelle » link moves in one rename.
publier() {
	construction=$1
	depot="$COPIE/depot"
	commit=$(git -C "$depot" rev-parse HEAD) || return 1
	donnees=$(source_donnees)
	dcommit=$(git -C "$depot" rev-parse "$donnees") || return 1
	site="$COPIE/site"
	# named after the code and, with a data branch, after its commit too: a night of data alone is a
	# new copy
	nom="$commit"
	[ "$donnees" = HEAD ] || nom="$commit-${dcommit%"${dcommit#????????????}"}"
	mkdir -p "$site/versions" || return 1
	if [ ! -f "$site/versions/$nom/index.html" ]; then
		rm -rf "$site/versions/$nom.tmp"
		cp -R "$construction" "$site/versions/$nom.tmp" || return 1
		if git -C "$depot" cat-file -e "$donnees:data/keyinfo.json" 2>/dev/null; then
			git -C "$depot" archive "$donnees" data | tar -x -C "$site/versions/$nom.tmp" || return 1
		fi
		mv "$site/versions/$nom.tmp" "$site/versions/$nom" || return 1
	fi
	# relative target: the link resolves the same inside the web container (mounted elsewhere)
	ln -sfn "versions/$nom" "$site/actuelle.tmp" && mv -fT "$site/actuelle.tmp" "$site/actuelle" ||
		return 1
	# the GARDER most recent copies stay (to go back by hand: point « actuelle » to an older one)
	elaguer "$site/versions" "$nom"
	n=$(find "$site/versions/$nom/data" -name '*.enc.json' 2>/dev/null | wc -l | tr -d ' ')
	journal "copie publiée : commit ${commit%"${commit#????????????}"}, ${n} fichier(s) chiffré(s)"
}

synchro() {
	verifier_reglages
	mkdir -p "$COPIE" || die "dossier impossible à créer : $COPIE"
	recuperer || die "dépôt injoignable ou refusé : la copie précédente reste servie"
	construction=$(construire) || die "construction impossible : la copie précédente reste servie"
	publier "$construction" || die "publication impossible : la copie précédente reste servie"
}

case "${1:-}" in
synchro) synchro ;;
attente)
	verifier_reglages
	attente
	;;
boucle)
	verifier_reglages
	while :; do
		# a failed night is logged; the next one tries again
		(synchro) || true
		s=$(attente) || die "HEURE illisible" 2
		journal "prochaine synchro dans ${s} s (HEURE=$HEURE)"
		sleep "$s"
	done
	;;
*)
	printf 'usage : %s synchro | boucle | attente\n' "$0" >&2
	exit 2
	;;
esac
