#!/usr/bin/env node
// #361: Claude Code hooks (.claude/settings.json), in Node so that they run the same under Linux
// and Windows (no jq, no Git Bash). Model: Mousse de Poche, .claude/hooks/crochet.mjs.
//
//   node .claude/hooks/crochet.mjs avant-commit   PreToolUse (Bash): a `git commit` runs the quick
//                                                 gate first; red → the commit is refused (exit 2)
//   node .claude/hooks/crochet.mjs demarrage      SessionStart: state of the CI of main
//
// What the hook cannot see, it says; it never blocks for a reason other than a red gate.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** True for a shell command that creates a commit (not `git commit-tree`, not a quoted mention). */
export function isCommit(cmd) {
  return /(^|[;&|(]\s*|\s)git(\s+-C\s+\S+)?\s+commit(\s|$)/.test(String(cmd ?? ''));
}

async function stdin() {
  let s = '';
  for await (const c of process.stdin) s += c;
  return s;
}

async function avantCommit() {
  let input = {};
  try {
    input = JSON.parse(await stdin());
  } catch {
    return; // not a hook call: nothing to judge
  }
  if (!isCommit(input?.tool_input?.command)) return;
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'porte.mjs'), '--rapide'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) return;
  const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-40).join('\n');
  console.error(`Commit refusé : la porte rapide est rouge (node scripts/porte.mjs --rapide).\n${tail}`);
  process.exit(2);
}

function demarrage() {
  const r = spawnSync('gh', ['run', 'list', '--branch', 'main', '--workflow', 'ci.yml', '-L', '1', '--json', 'status,conclusion,headSha,displayTitle'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0 || r.error) {
    console.log('État de la CI de main : inconnu (gh absent ou non connecté). Le regarder avant de pousser (AGENTS.md §2).');
    return;
  }
  try {
    const [run] = JSON.parse(r.stdout);
    if (!run) return console.log('État de la CI de main : aucun run trouvé.');
    const state = run.status !== 'completed' ? `en cours (${run.status})` : run.conclusion === 'success' ? 'verte' : `ROUGE (${run.conclusion}) : ne rien empiler dessus, corriger d'abord`;
    console.log(`CI de main ${state} — ${String(run.headSha).slice(0, 7)} ${run.displayTitle}`);
  } catch {
    console.log('État de la CI de main : réponse de gh illisible.');
  }
}

const what = process.argv[2];
if (what === 'avant-commit') await avantCommit();
else if (what === 'demarrage') demarrage();
