# فحص ترتيب كروت المشاركين في غرفة الاجتماع

```bash
npm --prefix services/meet-recorder ci
node tests/diagnostics/room-stage-layout/run.mjs
```

يعرض `frontend/src/room/room.css` الحقيقي في Chromium (يحتاج متصفح Playwright فقط) على
`360x640` و`390x844` و`1280x720` بعدد 1 و3 و12 مشاركًا، مع بانر الصوت وبدونه، ويتأكد أن:
لا كارت يركب على آخر، آخر كارت يمكن الوصول إليه بالـscroll، ولا يوجد scroll أفقي.

علامة الكروت (markup) منسوخة في الأداة؛ حدّثها لو تغيّر `RoomTile` أو `MeetingRoomView`.
