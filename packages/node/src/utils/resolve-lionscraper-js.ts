import path from 'node:path';

/**
 * Resolves `lionscraper.js` inside the package `dist/` folder from a dirname
 * that lies under that `dist` tree (e.g. `.../dist/client`). Avoids
 * `dir.split(path.sep)` + `path.join(...)` on Unix absolute paths, which drops
 * the leading `/` when the first segment is empty.
 *
 * Matching is done on a `/`-normalized path so it works when `path.sep` is
 * `\` (e.g. tests on Windows simulating Linux install paths). Join uses
 * `path.posix` so leading `/` is preserved for Unix-style absolute paths.
 */
export function resolveLionscraperJsFromPackageDir(dir: string): string {
  const norm = dir.replace(/\\/g, '/');
  const needle = '/dist/';
  const i = norm.lastIndexOf(needle);
  if (i >= 0) {
    const base = norm.slice(0, i + '/dist'.length);
    return path.posix.join(base, 'lionscraper.js');
  }
  if (norm.endsWith('/dist')) {
    return path.posix.join(norm, 'lionscraper.js');
  }
  return path.join(dir, '..', '..', 'dist', 'lionscraper.js');
}
