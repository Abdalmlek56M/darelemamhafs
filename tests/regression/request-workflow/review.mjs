import { setup, review, insertRequest, seedAttendance, OLD, NEW } from './common.mjs';

const c = await setup();
const results = [];
const add = (name, value) => results.push({ name, value });

const oldAbs = insertRequest('absence', '2026-11-02');
add('old_absence', await review(OLD, c.revOld, oldAbs));
const newAbs = insertRequest('absence', '2026-11-09');
add('new_absence', await review(NEW, c.revNew, newAbs));

const oldCan = insertRequest('cancellation', '2026-11-16');
add('old_cancellation', await review(OLD, c.revOld, oldCan));
const newCan = insertRequest('cancellation', '2026-11-23');
add('new_cancellation', await review(NEW, c.revNew, newCan));

const oldCorrDate = '2026-11-30';
const oldCorrAtt = seedAttendance(oldCorrDate);
const oldCorr = insertRequest('correction', oldCorrDate, oldCorrAtt, { durationMinutes: 45, status: 'present' });
add('old_correction', await review(OLD, c.revOld, oldCorr));
const newCorrDate = '2026-12-07';
const newCorrAtt = seedAttendance(newCorrDate);
const newCorr = insertRequest('correction', newCorrDate, newCorrAtt, { durationMinutes: 45, status: 'present' });
add('new_correction', await review(NEW, c.revNew, newCorr));

const oldReject = insertRequest('absence', '2026-12-14');
add('old_reject', await review(OLD, c.revOld, oldReject, false, 'no'));
const newReject = insertRequest('absence', '2026-12-21');
add('new_reject', await review(NEW, c.revNew, newReject, false, 'no'));

console.log(JSON.stringify({ suite: 'review', ok: true, count: results.length, results }, null, 2));
