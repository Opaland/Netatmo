// #555: each view loaded on demand (src/views/lazy-views.ts) has a chunk of its own, never preloaded by
// the first screen. Used by size-budget.mjs, tested by src/vues-differees.test.ts.
// #640 (#564 n° 4): Vite names the chunk `<module>-<hash>.js`, the hash 8 characters long today. A
// chunk named otherwise (another hash length after a Vite update) is not taken for the view — a
// chunk `analyse-foo-<hash>.js` of another module would look the same —, but the failure names it,
// so that nobody goes looking for a static import that is not there.

const HASH = /[\w-]{8}/.source;

/**
 * What is wrong with the deferred views, one line each (empty: all good).
 * @param {string[]} files the chunks of dist/, as `assets/<name>.js`
 * @param {Set<string>} first the chunks the first screen loads (entry and preloads)
 * @param {string[]} views the modules loaded on demand
 */
export function deferredViewProblems(files, first, views) {
  return views.flatMap((name) => {
    const own = files.filter((f) => new RegExp(`^assets/${name}-${HASH}\\.js$`).test(f));
    if (!own.length) {
      const odd = files.filter((f) => f.startsWith(`assets/${name}-`) && f.endsWith('.js'));
      if (odd.length)
        return [
          `${name} : ${odd.join(', ')} n'a pas la forme attendue « ${name}-<hachage de 8 caractères>.js » ` +
            `(Vite a-t-il changé la longueur du hachage ? adapter HASH dans scripts/vues-differees.mjs)`,
        ];
      return [`${name} : pas de morceau à part (fusionné dans un autre, importé en statique ?)`];
    }
    return own.filter((f) => first.has(f)).map((f) => `${name} : ${f} est préchargé par le premier écran`);
  });
}
