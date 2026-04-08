import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const version = readFileSync(join(repoRoot, 'VERSION'), 'utf8').trim();
if (!/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error(`Invalid VERSION: ${JSON.stringify(version)}`);
}

writeFileSync(join(repoRoot, 'packages', 'python', 'VERSION'), `${version}\n`, 'utf8');

function writeJson(path, obj) {
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

const pkgPath = join(repoRoot, 'packages', 'node', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeJson(pkgPath, pkg);

for (const rel of ['packages/node/server.json', 'packages/python/server.json']) {
  const p = join(repoRoot, ...rel.split('/'));
  const srv = JSON.parse(readFileSync(p, 'utf8'));
  srv.version = version;
  if (srv.packages?.[0]) {
    srv.packages[0].version = version;
  }
  writeJson(p, srv);
}

process.stdout.write(
  `Synced version ${version} to package.json, server.json files, and packages/python/VERSION.\n`,
);
