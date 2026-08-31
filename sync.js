#!/usr/bin/osascript -l JavaScript
// macOS-only MSU timetable synchronizer. Uses only built-in tools.

ObjC.import("Foundation");
const app = Application.currentApplication();
app.includeStandardAdditions = true;

const fm = $.NSFileManager.defaultManager;
const root = app.doShellScript("/bin/pwd");
const lessonTimes = {
  "1": ["09:00", "10:30"],
  "2": ["10:45", "12:15"],
  "3": ["12:30", "14:00"],
  "4": ["15:00", "16:30"],
  "5": ["16:45", "18:15"],
};

function fail(message) {
  throw new Error(message);
}

function readText(path) {
  const error = $();
  const value = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, error);
  if (!value) fail(`Не удалось прочитать ${path}: ${ObjC.unwrap(error.localizedDescription)}`);
  return ObjC.unwrap(value);
}

function writeText(path, value) {
  const error = $();
  const ok = $(value).writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, error);
  if (!ok) fail(`Не удалось записать ${path}: ${ObjC.unwrap(error.localizedDescription)}`);
}

function ensureDirectory(path) {
  try { app.doShellScript(`/bin/mkdir -p ${quoteShell(path)}`); }
  catch (error) { fail(`Не удалось создать ${path}: ${error.message || error}`); }
}

function quoteShell(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`Некорректная дата: ${value}`);
  return value;
}

function ruDate(iso) {
  const parts = iso.split("-");
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function shellCurl(url, cookieFile, timeout, fields) {
  let command = `/usr/bin/curl --fail --silent --show-error --location --max-time ${Number(timeout) || 30}`;
  command += ` --cookie ${quoteShell(cookieFile)} --cookie-jar ${quoteShell(cookieFile)}`;
  (fields || []).forEach(([key, value]) => {
    command += ` --data-urlencode ${quoteShell(`${key}=${value}`)}`;
  });
  command += ` ${quoteShell(url)}`;
  try {
    return app.doShellScript(command);
  } catch (error) {
    fail(`Не удалось получить расписание: ${error.message || error}`);
  }
}

function csrf(html) {
  const match = html.match(/name="_csrf-frontend"\s+value="([^"]+)"/);
  if (!match) fail("Портал не вернул защитный токен формы. Его структура могла измениться.");
  return decodeHtml(match[1]);
}

function postPortal(url, cookieFile, timeout, previousPage, fields) {
  return shellCurl(url, cookieFile, timeout, [["_csrf-frontend", csrf(previousPage)]].concat(fields));
}

function fetchGroupHtml(config, group, fromDate, toDate) {
  if (!group.portalId) fail(`Для ${group.id} не указан portalId в config.json.`);
  const cookieFile = `/tmp/msu-calendar-${Date.now()}-${Math.random().toString(16).slice(2)}.cookies`;
  const url = config.portal.url;
  const timeout = config.portal.timeoutSeconds || 30;
  try {
    let page = shellCurl(url, cookieFile, timeout);
    page = postPortal(url, cookieFile, timeout, page, [["TimeTableForm[facultyId]", group.facultyId || "1"]]);
    page = postPortal(url, cookieFile, timeout, page, [
      ["TimeTableForm[facultyId]", group.facultyId || "1"],
      ["TimeTableForm[course]", group.course || "1"],
    ]);
    page = postPortal(url, cookieFile, timeout, page, [
      ["TimeTableForm[facultyId]", group.facultyId || "1"],
      ["TimeTableForm[course]", group.course || "1"],
      ["TimeTableForm[groupId]", group.portalId],
      ["TimeTableForm[dateStart]", ruDate(fromDate)],
      ["TimeTableForm[dateEnd]", ruDate(toDate)],
      ["TimeTableForm[indicationDays]", "5"],
      ["time-table-type", "1"],
    ]);
    const selected = `<option value="${group.portalId}" selected>${group.id}</option>`;
    if (page.indexOf(selected) === -1) fail(`Портал не подтвердил выбор группы ${group.id}.`);
    return page;
  } finally {
    try { app.doShellScript(`/bin/rm -f ${quoteShell(cookieFile)}`); } catch (_) {}
  }
}

function eventsFromHtml(html, group, fromDate, toDate) {
  const eventPattern = /<div\b(?=[^>]*\bdata-toggle="popover")(?=[^>]*\btitle="([^"]+)")(?=[^>]*\bdata-content="([^"]+)")[^>]*>/g;
  const unique = {};
  let match;
  while ((match = eventPattern.exec(html)) !== null) {
    const label = decodeHtml(match[1]).trim();
    const titleMatch = label.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d+)\s+пара$/);
    if (!titleMatch) continue;
    const day = `${titleMatch[3]}-${titleMatch[2]}-${titleMatch[1]}`;
    if (day < fromDate || day > toDate) continue;
    let lines = decodeHtml(match[2]).replace(/<br\s*\/?>/gi, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    let interval = lines[0].match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
    if (interval) lines.shift();
    else interval = lessonTimes[titleMatch[4]];
    if (!interval || !lines.length) fail(`Неизвестное время ${titleMatch[4]} пары ${day}.`);
    const start = Array.isArray(interval) ? interval[0] : interval[1];
    const end = Array.isArray(interval) ? interval[1] : interval[2];
    const description = lines.slice(1).filter((line) => line !== group.id && !line.startsWith("Добавлено:")).join("\n");
    const event = { groupId: group.id, startsAt: `${day}T${start}`, endsAt: `${day}T${end}`, title: lines[0], description };
    unique[JSON.stringify(event)] = event;
  }
  const events = Object.keys(unique).map((key) => unique[key]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (!events.length) fail(`Портал не вернул занятий для ${group.id} в выбранном периоде.`);
  return events;
}

function fingerprint(eventsByGroup) {
  const text = JSON.stringify(eventsByGroup);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return first.toString(16).padStart(8, "0") + second.toString(16).padStart(8, "0");
}

function icalEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function foldIcal(line) {
  const bytes = $(line).dataUsingEncoding($.NSUTF8StringEncoding);
  if (bytes.length <= 75) return [line];
  const parts = [];
  let current = "";
  for (const character of line) {
    const candidate = current + character;
    if ($(candidate).dataUsingEncoding($.NSUTF8StringEncoding).length > 75) {
      parts.push(current);
      current = " " + character;
    } else current = candidate;
  }
  parts.push(current);
  return parts;
}

function exportIcs(calendars) {
  const outputDir = `${root}/exports`;
  ensureDirectory(outputDir);
  Object.keys(calendars).forEach((calendarName) => {
    const events = calendars[calendarName];
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MSU Philosophy Faculty//Calendar Sync//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icalEscape(calendarName)}`];
    events.forEach((event) => {
      const uid = fingerprint({ event });
      lines.push("BEGIN:VEVENT", `UID:${uid}@msu-schedule`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
        `DTSTART;TZID=Europe/Moscow:${event.startsAt.replace(/[-:]/g, "")}00`, `DTEND;TZID=Europe/Moscow:${event.endsAt.replace(/[-:]/g, "")}00`,
        `SUMMARY:${icalEscape(event.title)}`, `DESCRIPTION:${icalEscape(event.description)}`, "CATEGORIES:Университет", "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    const groupDigits = (events[0].groupId.match(/\d+/g) || ["schedule"]).join("");
    writeText(`${outputDir}/msu-${groupDigits}.ics`, lines.flatMap(foldIcal).join("\r\n") + "\r\n");
  });
}

function moscowDate(iso) {
  return new Date(`${iso}:00+03:00`);
}

function applyToCalendar(calendars, fromDate, toDate) {
  const Calendar = Application("Calendar");
  const start = moscowDate(`${fromDate}T00:00`);
  const end = moscowDate(`${toDate}T00:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  Object.keys(calendars).forEach((name) => {
    let calendar = Calendar.calendars.byName(name);
    if (!calendar.exists()) Calendar.make({ new: "calendar", withProperties: { name } });
    calendar = Calendar.calendars.byName(name);
    calendar.events().forEach((event) => {
      const eventStart = event.startDate();
      if (eventStart >= start && eventStart < end) event.delete();
    });
    calendars[name].forEach((event) => calendar.events.push(Calendar.Event({
      summary: event.title,
      startDate: moscowDate(event.startsAt),
      endDate: moscowDate(event.endsAt),
      description: event.description,
    })));
  });
}

function notify(message, title) {
  try { app.displayNotification(message, { withTitle: title || "Расписание МГУ" }); } catch (_) {}
}

function argumentsFromCommandLine() {
  const nativeArgs = $.NSProcessInfo.processInfo.arguments;
  const all = [];
  for (let index = 0; index < nativeArgs.count; index += 1) all.push(ObjC.unwrap(nativeArgs.objectAtIndex(index)));
  const scriptIndex = all.map(String).findIndex((value) => value.endsWith("/sync.js") || value === "sync.js");
  return scriptIndex >= 0 ? all.slice(scriptIndex + 1) : [];
}

function parseArgs() {
  const values = { config: `${root}/config.json`, dryRun: false, exportIcs: false, calendar: false, noNotify: false };
  const args = argumentsFromCommandLine();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--dry-run") values.dryRun = true;
    else if (args[index] === "--export-ics") values.exportIcs = true;
    else if (args[index] === "--calendar") values.calendar = true;
    else if (args[index] === "--no-notify") values.noNotify = true;
    else if (args[index] === "--from") values.from = args[++index];
    else if (args[index] === "--to") values.to = args[++index];
    else if (args[index] === "--config") values.config = args[++index];
    else fail(`Неизвестный параметр: ${args[index]}`);
  }
  return values;
}

function main() {
  const args = parseArgs();
  const config = JSON.parse(readText(args.config));
  const fromDate = isoDate(args.from || config.semester.from);
  const toDate = isoDate(args.to || config.semester.to);
  if (toDate < fromDate) fail("Конец периода раньше начала.");
  const eventsByGroup = {};
  config.groups.forEach((group) => { eventsByGroup[group.id] = eventsFromHtml(fetchGroupHtml(config, group, fromDate, toDate), group, fromDate, toDate); });
  const current = fingerprint(eventsByGroup);
  const statePath = `${root}/state.json`;
  const previous = fm.fileExistsAtPath($(statePath)) ? JSON.parse(readText(statePath)).fingerprint : "";
  if (args.dryRun) {
    Object.keys(eventsByGroup).forEach((id) => console.log(`${id}: ${eventsByGroup[id].length} занятий`));
    console.log(`Изменения: ${current === previous ? "нет" : "да"}`);
    return;
  }
  const calendars = {};
  config.groups.forEach((group) => { calendars[group.calendar] = eventsByGroup[group.id]; });
  const changed = current !== previous;
  exportIcs(calendars);
  writeText(statePath, JSON.stringify({ fingerprint: current, updatedAt: new Date().toISOString() }, null, 2) + "\n");
  if (args.exportIcs || !args.calendar) {
    console.log(changed ? "ICS-файл обновлён." : "ICS-файл без изменений.");
    if (changed && !args.noNotify) notify("Расписание обновлено.");
    return;
  }
  if (current === previous) { console.log("Расписание не изменилось."); return; }
  applyToCalendar(calendars, fromDate, toDate);
  console.log("Calendar обновлён.");
  if (!args.noNotify) notify("Расписание обновлено.");
}

try { main(); } catch (error) { console.log(`Ошибка: ${error.message || error}`); notify(String(error.message || error), "Расписание МГУ: ошибка"); throw error; }
