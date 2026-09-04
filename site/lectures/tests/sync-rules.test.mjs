import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fixtureUrl = new URL("../sync-fixtures.json", import.meta.url);
const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8")).cases;

function moscowIso(utcValue) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(utcValue)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+03:00`;
}

function parseManualName(name) {
  const match = String(name).match(/^Лекция:\s*\[([^\]]+)\]\s*(.+)$/iu);
  return match ? { source: "manual", course: match[1].trim(), title: match[2].trim() } : null;
}

function chooseCandidate(candidates) {
  return [...candidates].sort((left, right) => {
    const lectureDifference = Number(/лекция/iu.test(right.name)) - Number(/лекция/iu.test(left.name));
    if (lectureDifference) return lectureDifference;
    const offsetDifference = left.offsetMinutes - right.offsetMinutes;
    if (offsetDifference) return offsetDifference;
    return right.durationSeconds - left.durationSeconds;
  })[0];
}

function scheduleDetails(events, targetUid) {
  const ordered = [...events].sort((left, right) => left.startAt.localeCompare(right.startAt));
  const index = ordered.findIndex((event) => event.uid === targetUid);
  const lines = String(ordered[index].description || "").replace(/\\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const instructor = lines.slice(1).join(" ").replace(/\\,/g, ",").trim();
  return { lessonNumber: index + 1, instructor: instructor || "" };
}

const utcCase = fixtures.find((item) => item.expectedLocalStart);
assert.equal(moscowIso(utcCase.recording.startAt), utcCase.expectedLocalStart);

const duplicateCase = fixtures.find((item) => item.expectedName);
assert.equal(chooseCandidate(duplicateCase.candidates).name, duplicateCase.expectedName);

const manualCase = fixtures.find((item) => item.expectedSource);
assert.deepEqual(parseManualName(manualCase.recordingName), {
  source: manualCase.expectedSource,
  course: manualCase.expectedCourse,
  title: "Аристотель"
});

const processingCase = fixtures.find((item) => item.before);
assert.equal(processingCase.before.status, "processing");
assert.equal(processingCase.after.status, "ready");
assert.ok(processingCase.after.summary);
assert.ok(processingCase.after.topics.length);

assert.deepEqual(scheduleDetails([
  { uid: "first", startAt: "2026-09-02T09:00:00+03:00", description: "ауд. В2\\nКозырев Алексей Павлович" },
  { uid: "second", startAt: "2026-09-02T10:45:00+03:00", description: "ауд. В2\\nКостикова Анна Анатольевна" }
], "second"), { lessonNumber: 2, instructor: "Костикова Анна Анатольевна" });

function qualifiesByOverlap(recording, lesson) {
  const start = new Date(recording.startedAt).getTime();
  const end = start + recording.durationSeconds * 1000;
  const lessonStart = new Date(lesson.startsAt).getTime();
  const lessonEnd = new Date(lesson.endsAt).getTime();
  return Math.max(0, Math.min(end, lessonEnd) - Math.max(start, lessonStart)) >= 5 * 60 * 1000;
}

assert.equal(qualifiesByOverlap(
  { startedAt: "2026-09-02T12:43:07+03:00", durationSeconds: 2039 },
  { startsAt: "2026-09-02T12:40:00+03:00", endsAt: "2026-09-02T14:10:00+03:00" }
), true);
assert.equal(qualifiesByOverlap(
  { startedAt: "2026-09-02T12:43:07+03:00", durationSeconds: 120 },
  { startsAt: "2026-09-02T12:40:00+03:00", endsAt: "2026-09-02T14:10:00+03:00" }
), false);
