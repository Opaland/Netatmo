#!/usr/bin/env bash
# Where the encrypted data lives: on `main` (default) or in a branch of its own (S-8.3, #23).
#
# The repository variable DATA_BRANCH chooses it. Unset (or "main"), nothing changes: data/ of the
# checkout is read and written. Set to "data", every workflow that reads or writes the data
# opens that branch beside the code; the code still comes from main. Setting the variable is the
# owner's gesture, after the « Branche des données » workflow has copied the files (README,
# « Branche des données »).
#
#   scripts/donnees.sh ouvrir DIR [PATH...]
#       Exports DATA_REPO (the checkout to commit from), DATA_DIR (its data/) and, when the data
#       has its own branch, DATA_BRANCH (where commit-data.sh pushes) to $GITHUB_ENV.
#       Main: DATA_REPO is the current checkout. Branch: a worktree of it in DIR (depth 1); with
#       PATHs, only those files are checked out (sparse).
#   scripts/donnees.sh copier SOURCE DEST OUT
#       Prepares, without sending anything, a commit of DEST whose data/ is exactly the data/ of
#       SOURCE (the same git tree, nothing else of DEST changes; DEST absent: a branch holding
#       data/ only). Refused when DEST is where the data is read and written today (DATA_BRANCH):
#       the copy would overwrite the nights collected there. Writes OUT/commit (empty when there
#       is nothing to copy), and both data/ in OUT/source and OUT/copie for `collector comparer`.
#   scripts/donnees.sh pousser OUT DEST
#       Pushes OUT/commit to DEST. Never forced: when DEST moved meanwhile, the push is refused.
#
# Public logs: branch names, counts and commit ids only.
set -euo pipefail

die() {
  echo "::error::$*" >&2
  exit 1
}

# Two places only, so that the « Branche des données » workflow knows both ends of every move.
current() {
  case "${DATA_BRANCH:-main}" in
    main) echo main ;;
    data) echo data ;;
    *) die "DATA_BRANCH vaut « main » ou « data » (ou n'est pas posée)" ;;
  esac
}

export_env() {
  if [ -n "${GITHUB_ENV:-}" ]; then echo "$1" >> "$GITHUB_ENV"; fi
  echo "$1"
}

fetch_branch() {
  git ls-remote --exit-code --heads origin "$1" > /dev/null 2>&1 \
    || die "La branche « $1 » n'existe pas sur le dépôt : lancez d'abord le workflow « Branche des données »"
  git fetch -q --depth=1 origin "+refs/heads/$1:refs/remotes/origin/$1"
}

cmd_ouvrir() {
  local dir=${1:?DIR}
  shift
  local branch
  branch=$(current)
  if [ "$branch" = main ]; then
    export_env "DATA_REPO=$PWD"
    export_env "DATA_DIR=$PWD/data"
    return
  fi
  fetch_branch "$branch"
  if [ $# -gt 0 ]; then
    git worktree add -q --no-checkout --detach "$dir" "origin/$branch"
    git -C "$dir" sparse-checkout set --no-cone "$@"
    git -C "$dir" checkout -q --detach "origin/$branch"
  else
    git worktree add -q --detach "$dir" "origin/$branch"
  fi
  dir=$(cd "$dir" && pwd)
  export_env "DATA_REPO=$dir"
  export_env "DATA_DIR=$dir/data"
  export_env "DATA_BRANCH=$branch"
  echo "Données lues dans la branche $branch ($(git -C "$dir" rev-parse --short HEAD))."
}

cmd_copier() {
  local src=${1:?SOURCE} dest=${2:?DEST} out=${3:?OUT} now
  now=$(current)
  git check-ref-format --branch "$src" > /dev/null 2>&1 || die "Source invalide"
  git check-ref-format --branch "$dest" > /dev/null 2>&1 || die "Destination invalide"
  [ "$src" != "$dest" ] || die "La source et la destination sont la même branche"
  if [ "$dest" = "$now" ]; then
    die "« $dest » est la branche où les données sont lues et écrites aujourd'hui (DATA_BRANCH) : la copier écraserait les nuits collectées depuis. Copiez dans l'autre sens."
  fi
  fetch_branch "$src"
  local data
  data=$(git rev-parse -q --verify "origin/$src:data") || die "Pas de dossier data/ dans « $src »"
  local tree commit="" parent=""
  if git ls-remote --exit-code --heads origin "$dest" > /dev/null 2>&1; then
    git fetch -q --depth=1 origin "+refs/heads/$dest:refs/remotes/origin/$dest"
    parent=$(git rev-parse "origin/$dest")
    local index
    index=$(mktemp)
    rm -f "$index"
    # DEST's own tree, data/ replaced by SOURCE's (files absent from SOURCE disappear from data/
    # only: the copy is a mirror of data/, nothing else of DEST is touched).
    GIT_INDEX_FILE=$index git read-tree "$parent"
    GIT_INDEX_FILE=$index git rm -r -q --cached --ignore-unmatch data
    GIT_INDEX_FILE=$index git read-tree --prefix=data/ "$data"
    tree=$(GIT_INDEX_FILE=$index git write-tree)
    rm -f "$index"
    if [ "$tree" != "$(git rev-parse "$parent^{tree}")" ]; then
      commit=$(git commit-tree "$tree" -p "$parent" -m "data: copie de data/ depuis $src")
    fi
  else
    tree=$(printf '040000 tree %s\tdata\n' "$data" | git mktree)
    commit=$(git commit-tree "$tree" -m "data: copie de data/ depuis $src")
  fi
  rm -rf "$out"
  mkdir -p "$out/source" "$out/copie"
  git archive "origin/$src" data | tar -x -C "$out/source"
  if [ -z "$commit" ]; then
    : > "$out/commit"
    git archive "origin/$src" data | tar -x -C "$out/copie"
    echo "Rien à copier : data/ de « $dest » est déjà celui de « $src »."
    return
  fi
  # The copy is the very same tree as the source: byte for byte, file by file.
  [ "$(git rev-parse "$commit:data")" = "$data" ] || die "La copie diffère de la source"
  git archive "$commit" data | tar -x -C "$out/copie"
  echo "$commit" > "$out/commit"
  echo "Copie préparée : $(find "$out/copie/data" -type f | wc -l) fichiers de « $src » vers « $dest » (commit ${commit:0:12}, rien n'est encore envoyé)."
}

cmd_pousser() {
  local out=${1:?OUT} dest=${2:?DEST} commit
  commit=$(cat "$out/commit")
  if [ -z "$commit" ]; then
    echo "Rien à envoyer."
    return
  fi
  git push -q origin "$commit:refs/heads/$dest" \
    || die "Envoi refusé : « $dest » a bougé pendant la copie. Relancez le workflow."
  echo "Copie envoyée sur « $dest » (${commit:0:12})."
}

cmd=${1:-}
shift || true
case "$cmd" in
  ouvrir) cmd_ouvrir "$@" ;;
  copier) cmd_copier "$@" ;;
  pousser) cmd_pousser "$@" ;;
  *) die "usage : scripts/donnees.sh ouvrir|copier|pousser …" ;;
esac
