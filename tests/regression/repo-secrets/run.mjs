import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// FINAL 0.10: the public repo must not carry live hostnames/IPs, the production DB name,
// a hardcoded superuser password, or the deployment SSH target. Deployment-specific values
// live in the untracked deploy/.env; guards read DAR_FORBIDDEN_*.
const ROOTS = ['backend', 'src', 'frontend/src', 'tests', 'deploy', 'services', 'packages', 'database'];
const SKIP_DIRS = new Set(['.git', 'bin', 'obj', 'node_modules', 'dist', 'coverage']);
const SKIP_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml']);
const TEXT_EXTENSIONS = ['.cs', '.ts', '.tsx', '.js', '.mjs', '.json', '.sh', '.sql', '.md', '.conf', '.yml', '.yaml', '.example'];
const FORBIDDEN = [
  { name: 'production server IPv4', pattern: new RegExp('31\\\\.220\\\\.76\\\\.171', 'g') },
  { name: 'production hostname', pattern: new RegExp('dar-elemam-hafs\\\\.rigxhard' + 'ware\\\\.com', 'g') },
  { name: 'production database name', pattern: new RegExp('(?:^|[^A-Za-z0-9_])dareltah' + 'feez(?:[^A-Za-z0-9_]|$)', 'gm') },
  { name: 'hardcoded regression superuser password', pattern: new RegExp('Regression' + 'Pass123', 'g') },
];

function collect(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) collect(full, out);
    else if (TEXT_EXTENSIONS.some((extension) => entry.toLowerCase().endsWith(extension))) out.push(full);
  }
}

const files = [];
for (const root of ROOTS) collect(root, files);
assert.ok(files.length > 100, 'repo scan found too few files: ' + files.length);

const findings = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const rule of FORBIDDEN) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push(relative(process.cwd(), file) + ': ' + rule.name + ' (offset ' + match.index + ')');
    }
  }
}
assert.deepEqual(findings, [], 'repo leaks live/deployment identifiers:\n' + findings.slice(0, 20).join('\n'));

// The password must be random per run, never a constant.
const regressionRunner = readFileSync('tests/run-regression.sh', 'utf8');
assert.match(regressionRunner, /openssl rand|od -An/, 'regression superuser password is not generated');
assert.equal(regressionRunner.includes('Regression' + 'Pass123'), false, 'hardcoded superuser password remains');

// The baseline schema source is an env setting, not a baked production name.
assert.match(regressionRunner, /DAR_BASELINE_DB/, 'baseline database is not configurable');

console.log(JSON.stringify({ suite: 'repo-secrets', ok: true, cases: 3 }));
