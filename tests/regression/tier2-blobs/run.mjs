import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, one, q, req, OLD } from '../request-workflow/common.mjs';

// FINAL Tier 2.5 — receipts, branding logo and avatars are file-backed while legacy BYTEA rows
// stay readable through lazy migration.
//
// Harness contract (q6 mode):
//   * DAR_TEST_DATABASE / Q6_LEGACY_URL / Q6_NEW_URL / Q6_SETUP_TOKEN / Q6_PASSWORD — provided by
//     tests/run-regression.sh (the shared q6 prefix) and validated by ../request-workflow/common.mjs;
//   * Media__RootPath (env for Media:RootPath) — the runner should start the legacy app with a
//     writable temp dir, e.g. Media__RootPath=$APP/media. The suite asserts against the root the
//     app itself reports (GET /api/admin/media/status), so it works with any configured root.
//   * Q6_MEDIA_ROOT (optional, recommended) — same directory as the app's Media__RootPath. When
//     present it is cross-checked against the app-reported root and a mismatch fails loudly;
//     when absent the app-reported root is used.
//
// The suite uses the real HTTP endpoints (no direct file writes for expected rows) and asserts
// database columns, on-disk files, byte-identical downloads and the no-blob list contract.

const configuredMediaRoot = (process.env.Q6_MEDIA_ROOT || '').trim();
let mediaRoot = configuredMediaRoot ? resolve(configuredMediaRoot) : '';
const MIGRATION_FILE = fileURLToPath(new URL('../../../database/041_blob_file_storage.sql', import.meta.url));
const caseNames = [];

function pass(name) {
  caseNames.push(name);
}

function fileFor(relativePath) {
  return join(mediaRoot, ...String(relativePath).split('/').filter(Boolean));
}

function json(sql) {
  return JSON.parse(one(sql));
}

/** Unique valid PNG payload: signature + a random body, so content-addressed names are unique. */
function pngBytes(tag) {
  const body = Buffer.from(`tier2-blobs-${tag}-${randomUUID()}`, 'utf8');
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), body]);
}

const c = await setup();

// ---------------------------------------------------------------------------------------------
// 0. Harness wiring + schema
// ---------------------------------------------------------------------------------------------
const status = await req(OLD, c.admin, 'GET', '/api/admin/media/status');
assert.equal(status.status, 200, 'media status endpoint failed: ' + status.text.slice(0, 300));
assert.ok(status.json && typeof status.json.rootPath === 'string', 'media status has no rootPath');
const appReportedRoot = resolve(status.json.rootPath);
if (!mediaRoot) mediaRoot = appReportedRoot;
assert.equal(
  appReportedRoot,
  mediaRoot,
  'Media__RootPath of the legacy app (' + status.json.rootPath + ') differs from Q6_MEDIA_ROOT (' + mediaRoot + ')',
);
assert.ok(existsSync(mediaRoot), 'media root does not exist on disk: ' + mediaRoot);
pass('media root wiring matches between app and suite');

const expectedColumns = [
  ['payments', 'receipt_file_path'], ['payments', 'receipt_size_bytes'],
  ['app_users', 'avatar_file_path'], ['app_users', 'avatar_size_bytes'],
  ['school_settings', 'logo_file_path'], ['school_settings', 'logo_size_bytes'],
];
for (const [table, column] of expectedColumns) {
  assert.equal(
    one(`SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='${column}';`),
    '1',
    `migration 041 column ${table}.${column} is missing`,
  );
}
pass('migration 041 metadata columns exist');

// ---------------------------------------------------------------------------------------------
// 1. Seed a charge and upload a receipt through the real multipart endpoint
// ---------------------------------------------------------------------------------------------
const studentId = randomUUID();
const enrollmentId = randomUUID();
const chargeId = randomUUID();
one(`INSERT INTO students(id,student_code,full_name,status,joined_on)
  VALUES (${q(studentId)},'T25-BLOB-STUDENT','Tier 2.5 Blob Student','active',DATE '2026-01-01');`);
one(`INSERT INTO circle_enrollments(id,student_id,circle_id,starts_on,agreed_monthly_fee,status)
  VALUES (${q(enrollmentId)},${q(studentId)},${q(c.circleId)},DATE '2026-01-01',100,'active');`);
one(`INSERT INTO monthly_charges(id,enrollment_id,billing_month,amount_due)
  VALUES (${q(chargeId)},${q(enrollmentId)},DATE '2027-01-01',10);`);

const receiptBytes = pngBytes('receipt');
const uploadForm = new FormData();
uploadForm.append('monthlyChargeId', chargeId);
uploadForm.append('amount', '10');
uploadForm.append('method', 'cash');
uploadForm.append('reference', 'tier2-blobs');
uploadForm.append('receipt', new Blob([receiptBytes], { type: 'image/png' }), 'tier25-receipt.png');
const upload = await fetch(OLD + '/api/payments/with-receipt', {
  method: 'POST',
  headers: { cookie: c.admin },
  body: uploadForm,
});
const uploadText = await upload.text();
assert.equal(upload.status, 201, 'receipt upload -> ' + upload.status + ' ' + uploadText.slice(0, 300));
const paymentId = JSON.parse(uploadText).id;
assert.ok(paymentId, 'receipt upload returned no payment id');

const receiptRow = json(`SELECT jsonb_build_object(
  'path',receipt_file_path,'size',receipt_size_bytes,'type',receipt_content_type,
  'legacyBytes',receipt_data IS NOT NULL)::text FROM payments WHERE id=${q(paymentId)};`);
assert.ok(typeof receiptRow.path === 'string' && receiptRow.path.length > 0, 'new payment row has no receipt_file_path');
assert.match(receiptRow.path, /^receipts\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/, 'unexpected receipt file path: ' + receiptRow.path);
assert.equal(Number(receiptRow.size), receiptBytes.length, 'receipt_size_bytes mismatch');
assert.equal(receiptRow.type, 'image/png', 'receipt_content_type mismatch');
assert.equal(receiptRow.legacyBytes, false, 'new uploads must not write the legacy receipt_data BYTEA');
const receiptFile = fileFor(receiptRow.path);
assert.ok(existsSync(receiptFile), 'receipt file missing on disk: ' + receiptFile);
assert.ok(readFileSync(receiptFile).equals(receiptBytes), 'receipt file bytes differ from the upload');
pass('receipt upload stores path/size/content-type and a real file, no new BYTEA');

// Download must be byte-identical with the same content type (and attachment for download=1).
const download = await fetch(OLD + `/api/payments/${paymentId}/receipt`, { headers: { cookie: c.admin } });
assert.equal(download.status, 200, 'receipt download -> ' + download.status);
assert.equal(download.headers.get('content-type'), 'image/png', 'receipt download content-type changed');
assert.ok(Buffer.from(await download.arrayBuffer()).equals(receiptBytes), 'receipt download bytes differ');
const attachment = await fetch(OLD + `/api/payments/${paymentId}/receipt?download=true`, { headers: { cookie: c.admin } });
assert.equal(attachment.status, 200, 'download=true receipt -> ' + attachment.status);
assert.match(attachment.headers.get('content-disposition') ?? '', /^attachment;/, 'download=true must be an attachment');
pass('receipt download returns identical bytes and content type from the file');

// List/detail JSON must expose hasReceipt, never the blob.
const history = await req(OLD, c.admin, 'GET', `/api/students/${studentId}/history`);
assert.equal(history.status, 200, 'student history -> ' + history.status + ' ' + history.text.slice(0, 250));
assert.equal(history.text.includes(receiptBytes.toString('base64')), false, 'student history JSON contains the receipt bytes');
assert.equal(/data:image\//.test(history.text), false, 'student history JSON contains an inline image data URL');
const historyPayments = (JSON.parse(history.text).charges ?? []).flatMap(charge => charge.payments ?? []);
const historyPayment = historyPayments.find(candidate => candidate.id === paymentId);
assert.ok(historyPayment, 'uploaded payment missing from student history');
assert.equal(historyPayment.hasReceipt, true, 'hasReceipt must be true for a file-backed receipt');
assert.equal(Object.hasOwn(historyPayment, 'receiptData'), false, 'history payment exposes receiptData');
const collections = await req(OLD, c.admin, 'GET', '/api/collections?month=2027-01');
assert.equal(collections.status, 200, 'collections -> ' + collections.status);
assert.equal(/base64/i.test(collections.text), false, 'collections JSON contains base64 content');
pass('list/detail endpoints expose hasReceipt only, never the blob');

// ---------------------------------------------------------------------------------------------
// 2. Avatar PUT/GET round trip through the file path
// ---------------------------------------------------------------------------------------------
const avatarBytes = pngBytes('avatar');
const avatarPut = await req(OLD, c.admin, 'PUT', '/api/auth/profile/avatar', {
  dataUrl: 'data:image/png;base64,' + avatarBytes.toString('base64'),
});
assert.equal(avatarPut.status, 200, 'avatar PUT -> ' + avatarPut.status + ' ' + avatarPut.text.slice(0, 250));
const avatarRow = json(`SELECT jsonb_build_object('path',avatar_file_path,'size',avatar_size_bytes,
  'type',avatar_content_type,'legacyBytes',avatar_data IS NOT NULL)::text FROM app_users WHERE id=${q(c.adminId)};`);
assert.ok(typeof avatarRow.path === 'string' && avatarRow.path.startsWith('avatars/'), 'avatar_file_path missing: ' + JSON.stringify(avatarRow));
assert.equal(Number(avatarRow.size), avatarBytes.length, 'avatar_size_bytes mismatch');
assert.equal(avatarRow.type, 'image/png');
assert.equal(avatarRow.legacyBytes, false, 'new avatar uploads must not write avatar_data BYTEA');
assert.ok(existsSync(fileFor(avatarRow.path)), 'avatar file missing on disk');
const avatarGet = await fetch(OLD + '/api/auth/profile/avatar', { headers: { cookie: c.admin } });
assert.equal(avatarGet.status, 200, 'avatar GET -> ' + avatarGet.status);
assert.equal(avatarGet.headers.get('content-type'), 'image/png');
assert.ok(Buffer.from(await avatarGet.arrayBuffer()).equals(avatarBytes), 'avatar GET bytes differ');
pass('avatar PUT/GET round trip through the file path');

// ---------------------------------------------------------------------------------------------
// 3. Branding logo round trip through the file path (data: URL contract unchanged)
// ---------------------------------------------------------------------------------------------
const logoBytes = pngBytes('logo');
const logoDataUrl = 'data:image/png;base64,' + logoBytes.toString('base64');
const settingsPut = await req(OLD, c.admin, 'PUT', '/api/admin/settings', {
  brandName: 'Q6 Brand',
  logoDataUrl,
  clearLogo: false,
  facebookUrl: '',
  tiktokUrl: '',
  whatsappUrl: '',
  trashRetentionDays: 30,
});
assert.equal(settingsPut.status, 200, 'branding PUT -> ' + settingsPut.status + ' ' + settingsPut.text.slice(0, 300));
const logoRow = json(`SELECT jsonb_build_object('path',logo_file_path,'size',logo_size_bytes,
  'type',logo_content_type,'legacyBytes',logo_data IS NOT NULL)::text FROM school_settings WHERE id=1;`);
assert.ok(typeof logoRow.path === 'string' && logoRow.path.startsWith('logos/'), 'logo_file_path missing: ' + JSON.stringify(logoRow));
assert.equal(Number(logoRow.size), logoBytes.length, 'logo_size_bytes mismatch');
assert.equal(logoRow.type, 'image/png');
assert.ok(existsSync(fileFor(logoRow.path)), 'logo file missing on disk');
const branding = await fetch(OLD + '/api/branding');
assert.equal(branding.status, 200, 'anonymous branding -> ' + branding.status);
const brandingJson = await branding.json();
assert.equal(brandingJson.brandName, 'Q6 Brand');
assert.equal(brandingJson.logoDataUrl, logoDataUrl, 'branding logo data URL is not byte-identical to the upload');
const adminSettings = await req(OLD, c.admin, 'GET', '/api/admin/settings');
assert.equal(adminSettings.status, 200);
assert.equal(adminSettings.json.logoDataUrl, logoDataUrl, 'admin settings logo data URL is not byte-identical');
pass('branding logo PUT/GET round trip via file path');

// ---------------------------------------------------------------------------------------------
// 4. Legacy BYTEA-only receipt: download still works (lazy migration) and afterwards has a path
// ---------------------------------------------------------------------------------------------
const legacyBytes = pngBytes('legacy-receipt');
const legacyPaymentId = randomUUID();
one(`INSERT INTO payments(id,monthly_charge_id,amount,paid_at,receipt_file_name,receipt_content_type,receipt_data,receipt_uploaded_at)
  VALUES (${q(legacyPaymentId)},${q(chargeId)},0.05,now()-INTERVAL '2 hours','legacy-receipt.png','image/png',
          decode(${q(legacyBytes.toString('base64'))},'base64'),now()-INTERVAL '2 hours');`);
const beforeLazy = json(`SELECT jsonb_build_object('path',receipt_file_path,'hasBytes',receipt_data IS NOT NULL)::text
  FROM payments WHERE id=${q(legacyPaymentId)};`);
assert.equal(beforeLazy.path, null, 'legacy fixture unexpectedly already has a file path');
assert.equal(beforeLazy.hasBytes, true, 'legacy fixture BYTEA was not seeded');
const legacyDownload = await fetch(OLD + `/api/payments/${legacyPaymentId}/receipt`, { headers: { cookie: c.admin } });
assert.equal(legacyDownload.status, 200, 'legacy receipt download -> ' + legacyDownload.status);
assert.equal(legacyDownload.headers.get('content-type'), 'image/png');
assert.ok(Buffer.from(await legacyDownload.arrayBuffer()).equals(legacyBytes), 'legacy receipt download bytes differ');
const afterLazy = json(`SELECT jsonb_build_object('path',receipt_file_path,'size',receipt_size_bytes,
  'type',receipt_content_type,'hasBytes',receipt_data IS NOT NULL)::text FROM payments WHERE id=${q(legacyPaymentId)};`);
assert.ok(typeof afterLazy.path === 'string' && afterLazy.path.length > 0, 'lazy migration did not record receipt_file_path');
assert.equal(Number(afterLazy.size), legacyBytes.length, 'lazy migration did not record receipt_size_bytes');
assert.equal(afterLazy.type, 'image/png');
assert.equal(afterLazy.hasBytes, true, 'lazy migration must leave the legacy BYTEA untouched');
const lazyFile = fileFor(afterLazy.path);
assert.ok(existsSync(lazyFile), 'lazy migration did not write the file');
assert.ok(readFileSync(lazyFile).equals(legacyBytes), 'lazy migration file bytes differ');
const secondDownload = await fetch(OLD + `/api/payments/${legacyPaymentId}/receipt`, { headers: { cookie: c.admin } });
assert.ok(Buffer.from(await secondDownload.arrayBuffer()).equals(legacyBytes), 'file-backed reread bytes differ');
pass('legacy BYTEA-only receipt lazy-migrates on download and keeps the bytes');

// Dual-read fallback: deleting the derived file after migration re-materialises it from BYTEA.
unlinkSync(lazyFile);
const repairedDownload = await fetch(OLD + `/api/payments/${legacyPaymentId}/receipt`, { headers: { cookie: c.admin } });
assert.equal(repairedDownload.status, 200, 'receipt download with a deleted file -> ' + repairedDownload.status);
assert.ok(Buffer.from(await repairedDownload.arrayBuffer()).equals(legacyBytes), 'fallback bytes differ');
assert.ok(existsSync(lazyFile), 'fallback did not re-create the file');
pass('missing file falls back to the legacy BYTEA and re-materialises the file');

// ---------------------------------------------------------------------------------------------
// 5. Legacy BYTEA-only avatar lazy migration
// ---------------------------------------------------------------------------------------------
const legacyAvatarBytes = pngBytes('legacy-avatar');
one(`UPDATE app_users SET avatar_file_path=NULL,avatar_size_bytes=NULL,avatar_content_type='image/png',
  avatar_data=decode(${q(legacyAvatarBytes.toString('base64'))},'base64') WHERE id=${q(c.adminId)};`);
const legacyAvatarGet = await fetch(OLD + '/api/auth/profile/avatar', { headers: { cookie: c.admin } });
assert.equal(legacyAvatarGet.status, 200, 'legacy avatar GET -> ' + legacyAvatarGet.status);
assert.ok(Buffer.from(await legacyAvatarGet.arrayBuffer()).equals(legacyAvatarBytes), 'legacy avatar bytes differ');
const avatarAfter = json(`SELECT jsonb_build_object('path',avatar_file_path,'size',avatar_size_bytes,
  'hasBytes',avatar_data IS NOT NULL)::text FROM app_users WHERE id=${q(c.adminId)};`);
assert.ok(typeof avatarAfter.path === 'string' && avatarAfter.path.length > 0, 'avatar lazy migration did not record a path');
assert.equal(Number(avatarAfter.size), legacyAvatarBytes.length);
assert.equal(avatarAfter.hasBytes, true, 'avatar lazy migration must leave the legacy BYTEA untouched');
assert.ok(existsSync(fileFor(avatarAfter.path)), 'avatar lazy migration did not write the file');
pass('legacy BYTEA-only avatar lazy-migrates on GET');

// ---------------------------------------------------------------------------------------------
// 6. Legacy BYTEA-only branding logo lazy migration
// ---------------------------------------------------------------------------------------------
const legacyLogoBytes = pngBytes('legacy-logo');
one(`UPDATE school_settings SET logo_file_path=NULL,logo_size_bytes=NULL,logo_content_type='image/png',
  logo_data=decode(${q(legacyLogoBytes.toString('base64'))},'base64') WHERE id=1;`);
const legacyBranding = await fetch(OLD + '/api/branding');
assert.equal(legacyBranding.status, 200);
const legacyBrandingJson = await legacyBranding.json();
assert.equal(legacyBrandingJson.logoDataUrl, 'data:image/png;base64,' + legacyLogoBytes.toString('base64'),
  'legacy logo lazy migration returned different bytes');
const logoAfter = json(`SELECT jsonb_build_object('path',logo_file_path,'size',logo_size_bytes,
  'hasBytes',logo_data IS NOT NULL)::text FROM school_settings WHERE id=1;`);
assert.ok(typeof logoAfter.path === 'string' && logoAfter.path.length > 0, 'logo lazy migration did not record a path');
assert.equal(Number(logoAfter.size), legacyLogoBytes.length);
assert.equal(logoAfter.hasBytes, true, 'logo lazy migration must leave the legacy BYTEA untouched');
assert.ok(existsSync(fileFor(logoAfter.path)), 'logo lazy migration did not write the file');
pass('legacy BYTEA-only branding logo lazy-migrates on GET');

// ---------------------------------------------------------------------------------------------
// 7. Deliberate batch backfill entry point (dry run + real run, idempotent re-run)
// ---------------------------------------------------------------------------------------------
const backfillFixtures = [];
for (const tag of ['batch-1', 'batch-2']) {
  const bytes = pngBytes(tag);
  const id = randomUUID();
  one(`INSERT INTO payments(id,monthly_charge_id,amount,paid_at,receipt_file_name,receipt_content_type,receipt_data,receipt_uploaded_at)
    VALUES (${q(id)},${q(chargeId)},0.02,now()-INTERVAL '3 hours','${tag}.png','image/png',
            decode(${q(bytes.toString('base64'))},'base64'),now()-INTERVAL '3 hours');`);
  backfillFixtures.push({ id, bytes });
}
const dryRun = await req(OLD, c.admin, 'POST', '/api/admin/media/backfill?dryRun=true');
assert.equal(dryRun.status, 200, 'backfill dry run -> ' + dryRun.status + ' ' + dryRun.text.slice(0, 300));
assert.ok(Number(dryRun.json.receipts.attempted) >= backfillFixtures.length,
  'backfill dry run counted ' + dryRun.json.receipts.attempted + ' pending receipts, expected >= ' + backfillFixtures.length);
const pendingAfterDryRun = json(`SELECT jsonb_build_object('pending',count(*))::text FROM payments
  WHERE receipt_data IS NOT NULL AND receipt_file_path IS NULL;`);
assert.equal(Number(pendingAfterDryRun.pending), Number(dryRun.json.receipts.attempted), 'dry run changed pending rows');
const backfill = await req(OLD, c.admin, 'POST', '/api/admin/media/backfill');
assert.equal(backfill.status, 200, 'backfill -> ' + backfill.status + ' ' + backfill.text.slice(0, 300));
assert.equal(Number(backfill.json.receipts.failed), 0, 'backfill reported failures: ' + JSON.stringify(backfill.json.receipts));
for (const fixture of backfillFixtures) {
  const row = json(`SELECT jsonb_build_object('path',receipt_file_path,'size',receipt_size_bytes,'hasBytes',receipt_data IS NOT NULL)::text
    FROM payments WHERE id=${q(fixture.id)};`);
  assert.ok(typeof row.path === 'string' && row.path.length > 0, 'backfill did not set a path for ' + fixture.id);
  assert.equal(Number(row.size), fixture.bytes.length);
  assert.equal(row.hasBytes, true, 'backfill must leave legacy BYTEA untouched');
  assert.ok(existsSync(fileFor(row.path)), 'backfill did not write the file for ' + fixture.id);
  const dl = await fetch(OLD + `/api/payments/${fixture.id}/receipt`, { headers: { cookie: c.admin } });
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(fixture.bytes), 'backfilled download bytes differ');
}
const rerun = await req(OLD, c.admin, 'POST', '/api/admin/media/backfill');
assert.equal(rerun.status, 200, 'backfill re-run -> ' + rerun.status);
assert.equal(Number(rerun.json.receipts.attempted), 0, 'backfill re-run must be a no-op');
pass('deliberate batch backfill migrates legacy rows, is idempotent and keeps bytes');

const finalStatus = await req(OLD, c.admin, 'GET', '/api/admin/media/status');
assert.equal(finalStatus.status, 200);
assert.equal(Number(finalStatus.json.pending.receipts), 0, 'pending receipts remain after backfill');
assert.equal(Number(finalStatus.json.pending.avatars), 0, 'pending avatars remain after lazy migration');
assert.equal(Number(finalStatus.json.pending.logos), 0, 'pending logos remain after lazy migration');
assert.ok(Number(finalStatus.json.fileBacked.receipts) >= 2, 'file-backed receipt count was not reported');
pass('media status reports zero pending rows after migration');

// ---------------------------------------------------------------------------------------------
// 8. Migration must be idempotent (append-only, re-runnable)
// ---------------------------------------------------------------------------------------------
const migrationSql = readFileSync(MIGRATION_FILE, 'utf8');
one(migrationSql);
assert.equal(
  one("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='receipt_file_path';"),
  '1',
  're-running migration 041 broke the schema',
);
pass('migration 041 is idempotent when re-applied');

assert.ok(caseNames.length >= 12, 'expected at least 12 assertions groups, ran ' + caseNames.length);
console.log(JSON.stringify({ suite: 'tier2-blobs', ok: true, cases: caseNames.length }));
