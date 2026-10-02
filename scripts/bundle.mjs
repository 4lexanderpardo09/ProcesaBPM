// Bundles the API, the worker and the seed into plain ES modules (docs/despliegue.md §2).
//
// The workspace packages export TypeScript source, so they are bundled; every third-party dependency stays external and is
// installed in the image with `pnpm deploy --prod`, so versions come from the lockfile and native modules (argon2) are the
// ones built for the image. No type checking happens here: `pnpm typecheck` does that.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

// The seed's driver (pg) is a devDependency of packages/db: the migrate image gets it from packages/migrate.
const thirdParty = (manifest) => Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).filter((name) => !name.startsWith('@procesabpm/'));

const targets = [
  { name: 'api', manifest: 'apps/api/package.json', entries: { main: 'apps/api/src/main.ts', worker: 'apps/api/src/worker.ts' }, outdir: 'dist/api' },
  { name: 'seed', manifest: 'packages/migrate/package.json', entries: { seed: 'packages/db/src/seed/run.ts' }, outdir: 'dist/seed' },
];

for (const target of targets) {
  const external = [...new Set([...thirdParty(readJson(target.manifest)), ...thirdParty(readJson('packages/db/package.json')), ...thirdParty(readJson('packages/shared/package.json'))])].filter((name) => name !== 'prisma');
  await build({
    absWorkingDir: root,
    entryPoints: target.entries,
    outdir: target.outdir,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    sourcemap: true,
    external: [...external, ...external.map((name) => `${name}/*`)],
    tsconfig: target.name === 'api' ? 'apps/api/tsconfig.json' : 'packages/db/tsconfig.json',
    logLevel: 'info',
  });
  // The bundles are ES modules: this tells Node so, without renaming the files.
  mkdirSync(join(root, target.outdir), { recursive: true });
  writeFileSync(join(root, target.outdir, 'package.json'), '{ "type": "module" }\n');
}
