#!/bin/sh
# Relevé de l'état des volets Wiser depuis le NAS (issue #200). LECTURE SEULE : le script ne
# fait que des GET vers la passerelle, jamais de commande.
#
#   volets.sh releve   toutes les 10 min (Planificateur de tâches DSM) : lit la passerelle et
#                      note dans le journal du jour les volets dont la position ou le mouvement
#                      a changé (et, au premier relevé du jour, la position de chacun)
#   volets.sh envoi    une fois par nuit : chiffre les journaux des jours terminés avec le
#                      certificat (clé PUBLIQUE) et les envoie au workflow « Volets » du dépôt
#   volets.sh test     un relevé sans rien écrire : ce que la passerelle répond, sans le secret
#   volets.sh cle      fabrique la paire de clés (une seule fois, voir docs/etudes/volets-wiser.md)
#
# Dépendances : sh POSIX, curl, openssl, awk, sed, date (présents sur DSM ; testé avec dash et
# busybox sh, tests/test_volets.py). Configuration : VOLETS_CONF ou volets.conf à côté du
# script, droits 600 (refusée sinon). Le secret de la passerelle et le jeton GitHub ne sont
# jamais écrits dans un journal ni passés en argument d'une commande (invisibles dans `ps`).
#
# Format du journal (une ligne par fait, champs séparés par « ; », vérifié strictement par
# collector/volets.py) :
#   J;1;AAAA-MM-JJ                       en-tête : version, jour
#   N;<id>;<nom>                         nom d'un volet (au premier relevé du jour, ou s'il change)
#   S;<epoch>;<id>;<0-100>;<mouvement>;<origine>
#                                        position (100 = ouvert, 0 = fermé), Stopped/Opening/
#                                        Closing/Other, origine de la commande (Manual, Schedule…)
#   E;<epoch>;<code>                     échec d'un relevé (une fois, jusqu'au prochain succès)
#   C;AAAA-MM-JJ;<24 nombres>;<échecs>   ajouté à l'envoi : relevés réussis heure par heure
set -u
umask 077

ici=$(cd "$(dirname "$0")" && pwd)
CONF=${VOLETS_CONF:-$ici/volets.conf}

die() {
	printf 'volets : %s\n' "$1" >&2
	exit "${2:-1}"
}

charger_conf() {
	[ -f "$CONF" ] || die "configuration absente : $CONF (voir docs/etudes/volets-wiser.md)"
	# Refused when anyone but the owner can read it (it holds the hub secret and the token).
	droits=$(ls -ln "$CONF" | awk '{print substr($1, 5, 6)}')
	[ "$droits" = "------" ] || die "droits trop larges sur $CONF : chmod 600 $CONF"
	HUB='' HUB_SECRET='' HTTPS=0 GITHUB_TOKEN='' DEPOT='Opaland/Netatmo' BRANCHE='main'
	DOSSIER="$ici/donnees" CERT="$ici/volets-certificat.pem" GARDER_JOURS=30
	GITHUB_API='https://api.github.com'
	# shellcheck disable=SC1090
	. "$CONF"
	[ -n "$HUB" ] || die "HUB manquant dans $CONF"
	mkdir -p "$DOSSIER" || die "dossier impossible à créer : $DOSSIER"
}

# ------------------------------------------------------------------ lecture de la passerelle
# Escape a value for a curl config line (inside double quotes).
echapper() {
	printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# GET /data/v2/domain/ into $1; prints the HTTP status (000 when unreachable).
lire_passerelle() {
	if [ "$HTTPS" = 1 ]; then
		# 2nd-generation hubs (recent firmware) answer in HTTPS with a self-signed certificate:
		# local network only, so it is not checked.
		url="https://$HUB/data/v2/domain/"
		k=-k
	else
		url="http://$HUB/data/v2/domain/"
		k=
	fi
	# The secret goes through curl's configuration on stdin, never on the command line.
	printf 'header = "SECRET: %s"\n' "$(echapper "$HUB_SECRET")" |
		curl -sS $k --max-time 20 -K - -H 'Accept: application/json' -o "$1" -w '%{http_code}' "$url" 2>/dev/null ||
		true
}

# Shutters of a domain answer, one line each: id;lift;movement;origin;name — and a first line
# G;<hardware generation>;<firmware>. A tiny JSON reader in awk (no jq on DSM): the document is
# split on double quotes, so the odd pieces are outside strings and the even ones inside.
extraire() {
	awk '
	{ buf = buf $0 "\n" }
	function unesc(s,   out, i, c, n) {
		out = ""; n = length(s)
		for (i = 1; i <= n; i++) {
			c = substr(s, i, 1)
			if (c == "\\" && i < n) {
				i++; c = substr(s, i, 1)
				if (c == "u") { c = "?"; i += 4 } else if (c == "n" || c == "t" || c == "r" || c == "b" || c == "f") c = " "
			}
			out = out c
		}
		return out
	}
	function put(v) {
		if (depth == 3 && ctype[2] == "a" && (key[1] == "Shutter" || key[1] == "Device")) val[key[1], idx[key[1]], key[3]] = v
		else if (depth == 2 && ctype[2] == "o" && key[1] == "System") sys[key[2]] = v
	}
	# No field separator, backslash or control character in a value; spaces trimmed.
	function clean(v) {
		gsub(/[;\\]/, " ", v); gsub(/[[:cntrl:]]/, " ", v); gsub(/^ +| +$/, "", v)
		return v
	}
	function scalar() {
		if (tok != "") { put(tok); tok = "" }
	}
	END {
		n = split(buf, p, "\"")
		depth = 0; tok = ""; ins = 0; s = ""
		for (i = 1; i <= n; i++) {
			if (ins) {
				# inside a string: a piece ending in an odd number of backslashes was cut on \"
				s = s p[i]
				m = match(p[i], /\\+$/) ? RLENGTH : 0
				if (m % 2 == 1) { s = s "\""; continue }
				ins = 0
				str = unesc(s); s = ""
				if (ctype[depth] == "o" && wantkey[depth]) { key[depth] = str; wantkey[depth] = 0; if (depth == 1) top[str] = 1 }
				else put(str)
				continue
			}
			q = p[i]; L = length(q)
			for (j = 1; j <= L; j++) {
				c = substr(q, j, 1)
				if (c == "{" || c == "[") {
					scalar(); depth++
					ctype[depth] = (c == "{") ? "o" : "a"; wantkey[depth] = (c == "{"); key[depth] = ""
					if (depth == 3 && ctype[2] == "a") idx[key[1]]++
				} else if (c == "}" || c == "]") { scalar(); depth-- }
				else if (c == ",") { scalar(); if (ctype[depth] == "o") wantkey[depth] = 1 }
				else if (c == ":") { scalar() }
				else if (c == " " || c == "\n" || c == "\r" || c == "\t") { scalar() }
				else tok = tok c
			}
			scalar(); ins = 1
		}
		if (!("System" in top)) { print "ERREUR;reponse_illisible"; exit }
		print "G;" clean(sys["HardwareGeneration"]) ";" clean(sys["ActiveSystemVersion"])
		for (d = 1; d <= idx["Device"]; d++) devname[val["Device", d, "id"]] = val["Device", d, "Name"]
		for (k = 1; k <= idx["Shutter"]; k++) {
			id = val["Shutter", k, "id"]; dev = val["Shutter", k, "DeviceId"]
			if (dev == "") dev = id
			name = val["Shutter", k, "Name"]
			if (name == "") name = devname[dev]
			name = clean(name)
			if (length(name) > 60) name = ""
			print clean(id) ";" clean(val["Shutter", k, "CurrentLift"]) ";" clean(val["Shutter", k, "LiftMovement"]) ";" clean(val["Shutter", k, "ControlSource"]) ";" name
		}
	}'
}

# Keep only well-formed shutter lines, with the values normalised: id;lift;movement;origin;name.
normaliser() {
	awk -F';' '
	NR == 1 { print; next }
	$1 !~ /^[0-9]+$/ || length($1) > 6 { next }
	$2 !~ /^[0-9]+(\.[0-9]+)?$/ { next }
	{
		lift = int($2 + 0.5); if (lift > 100) next
		mov = $3; if (mov != "Stopped" && mov != "Opening" && mov != "Closing") mov = "Other"
		src = $4; if (src !~ /^[A-Za-z]+$/ || length(src) > 24) src = "Other"
		print $1 ";" lift ";" mov ";" src ";" $5
	}'
}

# ------------------------------------------------------------------ relevé
journal() { printf '%s/journal-%s.txt' "$DOSSIER" "$1"; }

noter() {
	printf '%s\n' "$1" >>"$(journal "$jour")"
}

erreur_releve() {
	printf '%s;%s\n' "$heure" "$1" >>"$DOSSIER/releves-$jour.txt"
	# The journal gets the error once, until the next success.
	if [ "$(cat "$DOSSIER/erreur" 2>/dev/null)" != "$1" ]; then
		nouveau_jour
		noter "E;$maintenant;$1"
		printf '%s\n' "$1" >"$DOSSIER/erreur"
	fi
	printf 'volets : relevé impossible (%s)\n' "$1" >&2
	exit 2
}

nouveau_jour() {
	if [ ! -f "$(journal "$jour")" ]; then
		printf 'J;1;%s\n' "$jour" >"$(journal "$jour")"
		: >"$DOSSIER/etat"
		: >"$DOSSIER/noms"
	fi
}

releve() {
	charger_conf
	maintenant=$(date +%s)
	jour=$(date +%Y-%m-%d)
	heure=$(date +%H)
	tmp="$DOSSIER/.reponse"
	code=$(lire_passerelle "$tmp")
	case $code in
	200) ;;
	000 | '') rm -f "$tmp"; erreur_releve hub_injoignable ;;
	401 | 403) rm -f "$tmp"; erreur_releve secret_refuse ;;
	*) rm -f "$tmp"; erreur_releve http_erreur ;;
	esac
	lignes=$(extraire <"$tmp" | normaliser)
	rm -f "$tmp"
	case $lignes in
	ERREUR*) erreur_releve reponse_illisible ;;
	esac
	volets=$(printf '%s\n' "$lignes" | sed 1d)
	[ -n "$volets" ] || erreur_releve aucun_volet
	nouveau_jour
	rm -f "$DOSSIER/erreur"
	printf '%s;ok\n' "$heure" >>"$DOSSIER/releves-$jour.txt"
	# Names: written at the first reading of the day and whenever one changes.
	noms=$(printf '%s\n' "$volets" | awk -F';' '{print "N;" $1 ";" $5}')
	if [ "$noms" != "$(cat "$DOSSIER/noms" 2>/dev/null)" ]; then
		printf '%s\n' "$noms" >>"$(journal "$jour")"
		printf '%s\n' "$noms" >"$DOSSIER/noms"
	fi
	# Positions: only the shutters whose position or movement changed since the last reading.
	printf '%s\n' "$volets" | awk -F';' -v t="$maintenant" -v etat="$DOSSIER/etat" '
		BEGIN { while ((getline l < etat) > 0) { split(l, a, ";"); avant[a[1]] = a[2] ";" a[3] } }
		{ if (avant[$1] != $2 ";" $3) print "S;" t ";" $1 ";" $2 ";" $3 ";" $4 }' >>"$(journal "$jour")"
	printf '%s\n' "$volets" | awk -F';' '{print $1 ";" $2 ";" $3}' >"$DOSSIER/etat"
}

test_passerelle() {
	charger_conf
	tmp="$DOSSIER/.test"
	code=$(lire_passerelle "$tmp")
	printf 'Réponse HTTP de la passerelle : %s\n' "${code:-aucune}"
	if [ "$code" != 200 ]; then
		rm -f "$tmp"
		case $code in
		000 | '') echo "Passerelle injoignable : vérifiez HUB (adresse IP) et HTTPS dans la configuration." ;;
		401 | 403) echo "Secret refusé : récupérez-le de nouveau (mode configuration de la passerelle)." ;;
		esac
		exit 2
	fi
	lignes=$(extraire <"$tmp" | normaliser)
	rm -f "$tmp"
	case $lignes in
	ERREUR*) echo "Réponse illisible : ce n'est pas l'API locale attendue."; exit 2 ;;
	esac
	printf '%s\n' "$lignes" | awk -F';' '
		NR == 1 { printf "Passerelle : génération %s, micrologiciel %s\n", ($2 == "" ? "?" : $2), ($3 == "" ? "?" : $3)
		          if ($2 == 2) print "  2e génération : si la lecture échoue un jour, mettez HTTPS=1 dans la configuration."
		          next }
		{ n++; printf "  volet %s « %s » : position %s %% (%s), %s\n", $1, $5, $2, ($2 == 0 ? "fermé" : $2 == 100 ? "ouvert" : "entrouvert"), $3 }
		END { printf "%d volet(s) trouvé(s).\n", n }'
}

# ------------------------------------------------------------------ envoi
compte_releves() {
	# C;day;24 hourly counts of successful readings;failed readings
	awk -F';' -v j="$1" '
		{ h = $1 + 0; if ($2 == "ok") ok[h]++; else ko++ }
		END { s = ""; for (h = 0; h < 24; h++) s = s (h ? "," : "") (ok[h] + 0); print "C;" j ";" s ";" (ko + 0) }' \
		"$DOSSIER/releves-$1.txt" 2>/dev/null || printf 'C;%s;0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0;0\n' "$1"
}

# POST the dispatch body in file $1; prints the HTTP status.
declencher() {
	printf 'header = "Authorization: Bearer %s"\n' "$(echapper "$GITHUB_TOKEN")" |
		curl -sS --max-time 60 -K - -X POST \
			-H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
			--data-binary "@$1" -o /dev/null -w '%{http_code}' \
			"$GITHUB_API/repos/$DEPOT/actions/workflows/volets.yml/dispatches" 2>/dev/null || true
}

# Send the journal of day $1 (or, when it cannot be read or encrypted, an error code alone).
envoyer_jour() {
	j=$1
	corps="$DOSSIER/.corps"
	charge="$DOSSIER/.charge"
	err=''
	if [ ! -f "$(journal "$j")" ]; then
		err=aucun_releve
	else
		{ cat "$(journal "$j")"; compte_releves "$j"; } >"$charge"
		if [ "$(wc -c <"$charge")" -gt 40000 ]; then
			err=journal_trop_gros
		elif [ ! -f "$CERT" ]; then
			err=certificat_absent
		elif ! b64=$(openssl cms -encrypt -binary -aes256 -outform DER -in "$charge" "$CERT" 2>/dev/null | openssl base64 -A) ||
			[ -z "$b64" ]; then
			err=chiffrement_impossible
		fi
		rm -f "$charge"
	fi
	if [ -n "$err" ]; then
		printf '{"ref":"%s","inputs":{"jour":"%s","erreur":"%s"}}' "$BRANCHE" "$j" "$err" >"$corps"
	else
		printf '{"ref":"%s","inputs":{"jour":"%s","journal":"%s"}}' "$BRANCHE" "$j" "$b64" >"$corps"
	fi
	code=$(declencher "$corps")
	rm -f "$corps"
	if [ "$code" = 204 ]; then
		: >"$DOSSIER/envoye-$j"
		printf '%s envoi du %s : fait%s\n' "$(date '+%F %T')" "$j" "${err:+ (erreur signalée : $err)}" >>"$DOSSIER/volets.log"
		return 0
	fi
	printf '%s envoi du %s : refusé par GitHub (HTTP %s), nouvel essai la nuit prochaine\n' \
		"$(date '+%F %T')" "$j" "${code:-aucune réponse}" >>"$DOSSIER/volets.log"
	return 1
}

envoi() {
	charger_conf
	[ -n "$GITHUB_TOKEN" ] || die "GITHUB_TOKEN manquant dans $CONF"
	auj=$(date +%Y-%m-%d)
	echec=0
	fait=
	# The last 7 finished days not sent yet (a night without network is caught up the next one).
	jours=$(
		for f in "$DOSSIER"/journal-*.txt "$DOSSIER"/releves-*.txt; do
			[ -f "$f" ] || continue
			b=${f##*/}
			b=${b#*-}
			echo "${b%.txt}"
		done | sort -u | awk -v a="$auj" '$0 < a' | tail -n 7
	)
	# Yesterday is always sent, even with no journal at all (an error line rather than nothing).
	hier=$(date -d "@$(($(date +%s) - 86400))" +%Y-%m-%d 2>/dev/null || date -d yesterday +%Y-%m-%d 2>/dev/null || true)
	for j in $jours $hier; do
		[ -f "$DOSSIER/envoye-$j" ] && continue
		case " $fait " in *" $j "*) continue ;; esac
		fait="$fait $j"
		envoyer_jour "$j" || echec=1
	done
	# Housekeeping: journals, counters and markers older than GARDER_JOURS days.
	find "$DOSSIER" -type f \( -name 'journal-*' -o -name 'releves-*' -o -name 'envoye-*' \) \
		-mtime +"$GARDER_JOURS" -exec rm -f {} \; 2>/dev/null
	[ "$echec" = 0 ] || die "un envoi au moins a échoué (détail : $DOSSIER/volets.log)" 3
}

# ------------------------------------------------------------------ clés
cle() {
	sortie=${1:-$ici}
	[ ! -f "$sortie/volets-certificat.pem" ] || die "$sortie/volets-certificat.pem existe déjà : supprimez-le d'abord"
	openssl req -x509 -newkey rsa:3072 -nodes -days 7300 -subj '/CN=volets-wiser' \
		-keyout "$sortie/volets-cle-privee.pem" -out "$sortie/volets-certificat.pem" 2>/dev/null ||
		die "openssl n'a pas pu fabriquer la paire de clés"
	echo "Certificat (public) : $sortie/volets-certificat.pem — il reste sur le NAS et va dans le dépôt."
	echo "Clé privée : $sortie/volets-cle-privee.pem — copiez TOUT son contenu, avec le certificat,"
	echo "dans le secret GitHub VOLETS_PRIVATE_KEY, puis SUPPRIMEZ ce fichier du NAS :"
	echo "  cat $sortie/volets-cle-privee.pem $sortie/volets-certificat.pem"
	echo "  rm $sortie/volets-cle-privee.pem"
}

case ${1:-} in
releve) releve ;;
envoi) envoi ;;
test) test_passerelle ;;
cle) cle "${2:-}" ;;
*) die "usage : volets.sh releve | envoi | test | cle [dossier]" 64 ;;
esac
