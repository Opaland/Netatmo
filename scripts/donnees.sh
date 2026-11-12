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
#       data/ only). Never backwards: refused unless the data/ DEST has today is one SOURCE already
#       had (the data/ tree of any commit of SOURCE, its whole history fetched: #529), i.e. nothing
#       was written on DEST since it was last copied from SOURCE. So a night collected on main between the copy
#       and DATA_BRANCH=data is caught up by copying again, and nights collected on data are never
#       overwritten. Writes OUT/commit (empty when there is nothing to copy) and the data/ of
#       SOURCE, of the copy and of DEST before (OUT/source, OUT/copie, OUT/avant) for `comparer`.
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
    || die "La branche « $1 » n'existe pas sur le dépôt : retirez la variable DATA_BRANCH (les données restent sur main), ou lancez d'abord le workflow « Branche des données »"
  git fetch -q --depth="${2:-1}" origin "+refs/heads/$1:refs/remotes/origin/$1"
}

# The data/ tree of a commit (empty when it has none).
data_tree() {
  git rev-parse -q --verify "$1:data" 2> /dev/null || true
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
  local src=${1:?SOURCE} dest=${2:?DEST} out=${3:?OUT}
  current > /dev/null # DATA_BRANCH must be main, data or unset
  git check-ref-format --branch "$src" > /dev/null 2>&1 || die "Source invalide"
  git check-ref-format --branch "$dest" > /dev/null 2>&1 || die "Destination invalide"
  [ "$src" != "$dest" ] || die "La source et la destination sont la même branche"
  fetch_branch "$src"
  local data
  data=$(data_tree "origin/$src")
  [ -n "$data" ] || die "Pas de dossier data/ dans « $src »"
  rm -rf "$out"
  mkdir -p "$out/source" "$out/copie" "$out/avant"
  git archive "origin/$src" data | tar -x -C "$out/source"
  local tree commit="" parent="" before=""
  if git ls-remote --exit-code --heads origin "$dest" > /dev/null 2>&1; then
    git fetch -q --depth=1 origin "+refs/heads/$dest:refs/remotes/origin/$dest"
    parent=$(git rev-parse "origin/$dest")
    before=$(data_tree "$parent")
    if [ -n "$before" ]; then git archive "$parent" data | tar -x -C "$out/avant"; fi
    if [ "$before" = "$data" ]; then
      : > "$out/commit"
      git archive "origin/$src" data | tar -x -C "$out/copie"
      echo "Rien à copier : data/ de « $dest » est déjà celui de « $src »."
      return
    fi
    # Never backwards: DEST's data/ must be one SOURCE had, nothing written on DEST since. No pipe
    # (#529: an early exit under pipefail could end in SIGPIPE): files, read once by git cat-file.
    if [ -n "$before" ]; then
      # The whole history of SOURCE, and of it only (fetched after DEST's depth-1 fetch, so that no
      # shallow boundary is left in it): DEST's data/ is looked for in every commit of SOURCE,
      # however old the last copy is (#529: a limit of 200 commits refused the way back after
      # months, with a wrong message).
      git fetch -q --depth=2147483647 origin "+refs/heads/$src:refs/remotes/origin/$src"
      git rev-list "origin/$src" > "$out/commits"
      sed 's/$/:data/' "$out/commits" > "$out/chemins"
      git cat-file --batch-check='%(objectname)' < "$out/chemins" > "$out/arbres"
      if ! grep -qxF "$before" "$out/arbres"; then
        die "data/ de « $dest » n'est dans aucun des $(wc -l < "$out/commits") commits de « $src » : « $dest » contient ce que « $src » n'a pas (des nuits collectées sur « $dest », ou sa phrase de passe changée, depuis la dernière copie). La copie le ferait reculer, rien n'est fait."
      fi
      rm -f "$out/commits" "$out/chemins" "$out/arbres"
    fi
    # DEST's own top-level tree, its data entry replaced by SOURCE's (no index involved).
    tree=$({
      git ls-tree "$parent" | awk -F '\t' '$2 != "data"'
      printf '040000 tree %s\tdata\n' "$data"
    } | git mktree)
    commit=$(git commit-tree "$tree" -p "$parent" -m "data: copie de data/ depuis $src")
  else
    tree=$(printf '040000 tree %s\tdata\n' "$data" | git mktree)
    commit=$(git commit-tree "$tree" -m "data: copie de data/ depuis $src")
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
