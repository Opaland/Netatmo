#!/usr/bin/env bash
# Commit the given paths (encrypted data only) and push them, used by collect.yml (#262).
#
#   scripts/commit-data.sh "message" data/            everything the collection wrote
#   scripts/commit-data.sh "message" data/netatmo-token.enc.json
#
# The push is retried when the branch moved during the collection (a pull request merged,
# a late run): fetch, rebase onto it (merge if the rebase stops), push again. Never forced.
# A commit left unpushed by an earlier step is pushed too.
#
# Run from $DATA_REPO (scripts/donnees.sh ouvrir): the checkout itself while the data lives on
# main, a worktree of the data branch otherwise (#23), which then exports DATA_BRANCH.
set -euo pipefail

msg=$1
shift
branch=${DATA_BRANCH:-${GITHUB_REF_NAME:-$(git rev-parse --abbrev-ref HEAD)}}
attempts=${PUSH_ATTEMPTS:-5}
pause=${PUSH_PAUSE:-5}

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

paths=()
for p in "$@"; do
  if [ -e "$p" ]; then paths+=("$p"); fi
done
if [ ${#paths[@]} -gt 0 ]; then
  git add -- "${paths[@]}"
fi
if ! git diff --cached --quiet; then
  git commit -q -m "$msg"
elif [ -z "$(git rev-list "origin/$branch..HEAD" 2>/dev/null)" ]; then
  echo "Aucune nouvelle donnée."
  exit 0
fi

for attempt in $(seq 1 "$attempts"); do
  if git push -q origin "HEAD:$branch"; then
    echo "Données envoyées sur $branch."
    exit 0
  fi
  [ "$attempt" -lt "$attempts" ] || break
  echo "::warning::Envoi refusé ($attempt/$attempts) : $branch a bougé pendant la collecte, intégration puis nouvel essai"
  sleep $((attempt * pause))
  git fetch -q origin "$branch"
  if ! git rebase -q --autostash "origin/$branch"; then
    git rebase --abort
    if ! git merge -q --no-edit "origin/$branch"; then
      git merge --abort
      echo "::error::Conflit avec $branch sur les données chiffrées : envoi abandonné"
      exit 1
    fi
  fi
done
echo "::error::Envoi des données impossible après $attempts tentatives"
exit 1
