import { strict as assert } from 'node:assert';
import { setup, req, OLD } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 1.2: on Linux the download endpoint looked in the Windows profile folder while
// backups are written under BackupRoot (app directory or Backup:RootPath). Create a real
// backup and download it through the API; this failed with 404 before the fix.
const created = await req(OLD, c.admin, 'POST', '/api/admin/backups', { scopes: ['students'] });
assert.equal(created.status, 200, 'backup creation status ' + created.text.slice(0, 300));
const body = JSON.parse(created.text);
const id = body.id ?? body.Id;
assert.ok(id, 'backup id missing in ' + created.text.slice(0, 200));

const response = await fetch(OLD + '/api/admin/backups/' + id + '/download', { headers: { cookie: c.admin } });
assert.equal(response.status, 200, 'backup download status ' + response.status);
const bytes = new Uint8Array(await response.arrayBuffer());
assert.ok(bytes.length > 1024, 'downloaded backup is suspiciously small: ' + bytes.length);
const disposition = response.headers.get('content-disposition') || '';
assert.ok(disposition.toLowerCase().includes('attachment') || disposition.includes('.backup'), 'missing download disposition: ' + disposition);

console.log(JSON.stringify({ suite: 'tier1-backup-download', ok: true, cases: 1 }));
