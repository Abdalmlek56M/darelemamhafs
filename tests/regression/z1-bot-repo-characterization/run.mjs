import { strict as assert } from 'node:assert';
import { setup, one, q } from '../request-workflow/common.mjs';

const c = await setup();
const NEW = process.env.Q6_NEW_URL || '';
const TOKEN = process.env.Q6_MEET_INTERNAL_TOKEN || '';
assert.ok(NEW && TOKEN, 'Q6 new URL / Meet internal token missing');

async function internal(method, path, body, token = TOKEN) {
  const response = await fetch(NEW + path, {
    method,
    headers: { 'content-type': 'application/json', 'X-Dar-Service-Token': token, 'X-Dar-Worker': 'z1-test-bot', origin: NEW },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, text: await response.text() };
}

// Z1 characterization: the bot control plane is the public behaviour of MeetBotJobRepository.
const noToken = await internal('GET', '/internal/meet/health', null, 'wrong-token');
assert.equal(noToken.status, 401, 'internal API accepted a wrong token');

const health = await internal('GET', '/internal/meet/health');
assert.equal(health.status, 200, 'bot health ' + health.text.slice(0, 200));
const healthBody = JSON.parse(health.text);
for (const field of ['status', 'pending', 'active', 'stale', 'staleAfterSeconds']) {
  assert.ok(field in healthBody, 'health missing ' + field);
}

const emptyClaim = await internal('POST', '/internal/meet/jobs/claim', {});
assert.equal(emptyClaim.status, 204, 'empty claim should be 204, got ' + emptyClaim.status + ' ' + emptyClaim.text.slice(0, 200));

const jobId = crypto.randomUUID();
one(`INSERT INTO meet_bot_jobs(id,occurrence_key,scheduled_start,scheduled_end,join_at,status,summary,meet_link)
  VALUES (${q(jobId)},'z1-occurrence',now()-interval '5 minutes',now()+interval '55 minutes',now()-interval '1 minute','scheduled','Z1 characterization','https://meet.google.com/z1-char');`);

const claim = await internal('POST', '/internal/meet/jobs/claim', {});
assert.equal(claim.status, 200, 'claim status ' + claim.status + ' ' + claim.text.slice(0, 200));
const claimed = JSON.parse(claim.text);
assert.equal(claimed.id, jobId);
assert.equal(claimed.status, 'joining');
assert.equal(one('SELECT status FROM meet_bot_jobs WHERE id=' + q(jobId) + ';'), 'joining', 'claim did not persist joining');

const blockedClaim = await internal('POST', '/internal/meet/jobs/claim', {});
assert.equal(blockedClaim.status, 204, 'a second job was claimed while one is active');

const heartbeat = await internal('POST', `/internal/meet/jobs/${jobId}/heartbeat`, { participants: 2, audioOk: true });
assert.equal(heartbeat.status, 200, 'heartbeat ' + heartbeat.text.slice(0, 200));

const live = await internal('POST', `/internal/meet/jobs/${jobId}/status`, { status: 'live', artifacts: [] });
assert.equal(live.status, 200, 'live status ' + live.text.slice(0, 240));
const finalizing = await internal('POST', `/internal/meet/jobs/${jobId}/status`, { status: 'finalizing', artifacts: [] });
assert.equal(finalizing.status, 200, 'finalizing status ' + finalizing.text.slice(0, 240));
const ready = await internal('POST', `/internal/meet/jobs/${jobId}/status`, {
  status: 'ready', durationSeconds: 10,
  artifacts: [{ kind: 'mp4', localPath: '/tmp/z1.mp4', sizeBytes: 1234, sha256: 'a'.repeat(64), durationSeconds: 10 }],
});
assert.equal(ready.status, 200, 'ready status ' + ready.text.slice(0, 240));
assert.equal(one('SELECT status FROM meet_bot_jobs WHERE id=' + q(jobId) + ';'), 'ready', 'job did not become ready');
assert.ok(Number(one('SELECT count(*) FROM meet_media_assets WHERE local_path=' + q('/tmp/z1.mp4') + ';')) >= 1, 'artifact was not recorded');

const invalidTransition = await internal('POST', `/internal/meet/jobs/${jobId}/status`, { status: 'live', artifacts: [] });
assert.equal(invalidTransition.status, 409, 'invalid transition accepted: ' + invalidTransition.status);

console.log(JSON.stringify({ suite: 'z1-bot-repo-characterization', ok: true, cases: 10 }));
