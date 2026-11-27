import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// FINAL Z3: docs must never drift from the real migration count.
//
// Source of truth: the ordered SQL files in database/ (001 -> NNN, optionally with a letter
// suffix when one logical migration is split, e.g. 039a/039b). Two tracked docs state that
// count for humans: README.md and docs/00-current-state.md. This suite fails when either doc
// says a different number, when the documented 001->NNN range end does not match the last
// migration number, or when two migrations share a number+suffix. It needs no database and no
// network: it only reads the tree.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DATABASE_DIR = join(ROOT, 'database');
// NNN_name.sql, or NNNx_name.sql when a single migration is split into ordered parts.
const MIGRATION_FILE = /^(\d{3})([a-z]?)_[A-Za-z0-9._-]+\.sql$/;

// Count statements intentionally look only like "the repository contains N migrations":
// historical deployment numbers (e.g. "ledger 26/26", "034->040") must not be captured.
const DOCUMENTS = [
  {
    file: 'README.md',
    patterns: [
      { name: 'migration count (README status table)', regex: /(\d+)\s+migration\s+في\s+المستودع/g },
      { name: 'migration count (README tree listing)', regex: /(\d+)\s+ordered\s+SQL\s+migrations/g },
    ],
  },
  {
    file: 'docs/00-current-state.md',
    patterns: [
      { name: 'migration count (current-state stack table)', regex: /(\d+)\s+migration\s+في\s+المستودع/g },
      { name: 'migration count (current-state owner map)', regex: /(\d+)\s+ملف\s+SQL/g },
    ],
  },
];

function readDoc(relativePath) {
  try {
    return readFileSync(join(ROOT, relativePath), 'utf8');
  } catch (error) {
    assert.fail('cannot read ' + relativePath + ': ' + error.message);
  }
}

// ---------------------------------------------------------------------------
// 1. Real migrations: count, numbers, duplicates, filename shape
// ---------------------------------------------------------------------------
const sqlFiles = readdirSync(DATABASE_DIR).filter((name) => name.toLowerCase().endsWith('.sql')).sort();
const realCount = sqlFiles.length;
assert.ok(realCount > 0, 'database/ contains no .sql migrations');

const byNumber = new Map();
const numbers = [];
const unparsed = [];
for (const name of sqlFiles) {
  const match = MIGRATION_FILE.exec(name);
  if (!match) {
    unparsed.push(name);
    continue;
  }
  const number = match[1];
  const suffix = match[2];
  const key = number + suffix;
  const bucket = byNumber.get(key) ?? [];
  bucket.push(name);
  byNumber.set(key, bucket);
  numbers.push(Number(number));
}

assert.deepEqual(
  unparsed,
  [],
  'database/*.sql files must be named NNN_name.sql (or NNNx_name.sql for a split migration); unrecognized: ' +
    unparsed.join(', '),
);

const duplicates = [...byNumber.entries()].filter(([, names]) => names.length > 1);
assert.deepEqual(
  duplicates,
  [],
  'duplicate migration numbers in database/: ' +
    duplicates.map(([number, names]) => number + ' -> ' + names.join(', ')).join('; '),
);

const uniqueNumbers = [...new Set(numbers)].sort((a, b) => a - b);
const firstNumber = uniqueNumbers[0];
const lastNumber = uniqueNumbers[uniqueNumbers.length - 1];
const gaps = [];
for (let expected = firstNumber; expected <= lastNumber; expected += 1) {
  if (!uniqueNumbers.includes(expected)) gaps.push(expected);
}

// ---------------------------------------------------------------------------
// 2. Documented counts: every statement must equal the real count
// ---------------------------------------------------------------------------
const problems = [];
const documentedCounts = [];
for (const document of DOCUMENTS) {
  const text = readDoc(document.file);
  let foundInDocument = 0;
  for (const pattern of document.patterns) {
    const matches = [...text.matchAll(pattern.regex)];
    foundInDocument += matches.length;
    for (const match of matches) {
      const documented = Number(match[1]);
      documentedCounts.push({ document: document.file, name: pattern.name, documented });
      if (!Number.isInteger(documented) || documented !== realCount) {
        problems.push(
          document.file +
            ': states ' +
            documented +
            ' migrations (' +
            pattern.name +
            ') but database/ contains ' +
            realCount,
        );
      }
    }
  }
  if (foundInDocument === 0) {
    problems.push(
      document.file +
        ': no migration-count statement found. Add e.g. "the repo has ' +
        realCount +
        ' migrations (001->' +
        String(realCount).padStart(3, '0') +
        ')".',
    );
  }
}

// The documented "001->NNN" range end is a second, independent statement of the last
// migration number in the same docs. It must match database/ as well (a split file keeps the
// same NNN, e.g. 039a/039b, so only the numeric prefix range is compared).
const rangeProblems = [];
const lastNumberPadded = String(lastNumber).padStart(3, '0');
for (const file of ['README.md', 'docs/00-current-state.md']) {
  const text = readDoc(file);
  for (const match of text.matchAll(/001→(\d{3})/g)) {
    const rangeEnd = Number(match[1]);
    if (rangeEnd !== lastNumber) {
      rangeProblems.push(
        file +
          ': documents migrations 001→' +
          match[1] +
          ' but the last migration number in database/ is ' +
          lastNumberPadded,
      );
    }
  }
}
problems.push(...rangeProblems);

assert.deepEqual(problems, [], 'documented migration count drifted from database/*.sql:\n  ' + problems.join('\n  '));

// ---------------------------------------------------------------------------
// 3. Report
// ---------------------------------------------------------------------------
const gapNote = gaps.length === 0 ? 'no gaps' : 'gaps: ' + gaps.join(',') + ' (warning only)';
console.log(
  'database/*.sql = ' +
    realCount +
    ' (last ' +
    sqlFiles[sqlFiles.length - 1] +
    ', ' +
    gapNote +
    '); documented = ' +
    documentedCounts.map((entry) => entry.document + ':' + entry.documented).join(', '),
);
console.log(JSON.stringify({ suite: 'docs-migration-count', ok: true, cases: 3, migrations: realCount }));
