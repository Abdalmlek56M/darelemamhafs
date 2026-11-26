import { strict as assert } from 'node:assert';
import { setup, one, req, NEW } from '../request-workflow/common.mjs';

const c = await setup();
one('INSERT INTO meet_settings(id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;');

async function getSettings() {
  const response = await req(NEW, c.admin, 'GET', '/api/v1/meet/settings');
  return { status: response.status, body: JSON.parse(response.text) };
}

// FINAL 0.5: the token is never echoed and blank saves never wipe it.
const initial = await getSettings();
assert.equal(initial.status, 200, 'meet settings status ' + JSON.stringify(initial.body));
assert.equal('telegramBotToken' in initial.body, false, 'GET settings leaked the bot token');
assert.equal(typeof initial.body.hasTelegramBotToken, 'boolean', 'GET settings has no set/not-set flag');

const saved = await req(NEW, c.admin, 'PUT', '/api/v1/meet/settings', { telegramBotToken: '123456:TEST-BOT-TOKEN' });
assert.equal(saved.status, 200, 'save token status ' + saved.text.slice(0, 200));
const savedBody = JSON.parse(saved.text);
assert.equal('telegramBotToken' in savedBody, false, 'PUT response leaked the bot token');
assert.equal(savedBody.hasTelegramBotToken, true, 'PUT response must report the token as set');
const stored = one('SELECT telegram_bot_token FROM meet_settings WHERE id=TRUE;');
assert.ok(stored && stored !== '123456:TEST-BOT-TOKEN', 'token stored in plaintext');
assert.equal(stored.includes('TEST-BOT-TOKEN'), false, 'token stored in plaintext');
assert.ok(stored.length > 40, 'token does not look like AES-GCM ciphertext');

const kept = await req(NEW, c.admin, 'PUT', '/api/v1/meet/settings', { joinLeadSeconds: 61 });
assert.equal(kept.status, 200, 'settings save without token status ' + kept.text.slice(0, 200));
assert.equal(one('SELECT telegram_bot_token FROM meet_settings WHERE id=TRUE;'), stored, 'saving settings wiped the stored token');
assert.equal(one('SELECT join_lead_seconds FROM meet_settings WHERE id=TRUE;'), '61', 'other settings were not saved');
const after = await getSettings();
assert.equal(after.body.hasTelegramBotToken, true, 'GET after blank save must still report the token as set');

console.log(JSON.stringify({ suite: 'tier0-meet-settings', ok: true, cases: 3 }));
