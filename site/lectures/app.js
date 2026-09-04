const TIME_ZONE = "Europe/Moscow";
const LOOKAHEAD_STUDY_DAYS = 2;
const $ = (selector) => document.querySelector(selector);

const state = { records: [], schedule: [], query: "", course: "", date: "" };

function recordWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "запись";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "записи";
  return "записей";
}

function pairWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "пара";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "пары";
  return "пар";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function dateParts(value, options) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, ...options }).formatToParts(new Date(value));
}

function dateKey(value) {
  const bits = Object.fromEntries(dateParts(value, { year: "numeric", month: "2-digit", day: "2-digit" })
    .filter((item) => ["year", "month", "day"].includes(item.type)).map((item) => [item.type, item.value]));
  return `${bits.year}-${bits.month}-${bits.day}`;
}

function dateFromKey(key) {
  return `${key}T12:00:00+03:00`;
}

function addDays(key, count) {
  const date = new Date(dateFromKey(key));
  date.setDate(date.getDate() + count);
  return dateKey(date);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long"
  }).format(new Date(value));
}

function formatTime(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date(value));
}

function formatDuration(seconds) {
  const minutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function unescapeIcs(value) {
  return String(value || "").replace(/\\\\n/gi, "\n").replace(/\\\\,/g, ",").replace(/\\\\;/g, ";").replace(/\\\\\\\\/g, "\\");
}

function readIcsField(block, name) {
  const line = block.split("\n").find((item) => item.startsWith(`${name}:`) || item.startsWith(`${name};`));
  return line ? unescapeIcs(line.slice(line.indexOf(":") + 1)).trim() : "";
}

function icsDateToIso(value) {
  const raw = String(value || "").trim();
  const utc = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z$/);
  if (utc) return new Date(Date.UTC(+utc[1], +utc[2] - 1, +utc[3], +utc[4], +utc[5], +(utc[6] || 0))).toISOString();
  const local = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/);
  if (!local) return "";
  return `${local[1]}-${local[2]}-${local[3]}T${local[4]}:${local[5]}:${local[6] || "00"}+03:00`;
}

function courseDetails(summary) {
  const match = String(summary || "").trim().match(/^(.*?)(?:\s*\[([^\]]+)\])?$/);
  return { course: (match?.[1] || "Пара по расписанию").trim().replace(/^дв(?=[А-ЯЁ])/u, ""), courseType: (match?.[2] || "").trim() };
}

function instructorFromDescription(description) {
  const lines = String(description || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const names = lines.filter((line) => /^[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+$/u.test(line));
  return names.join(", ");
}

function parseSchedule(ics) {
  const unfolded = String(ics || "").replace(/\r?\n[ \t]/g, "");
  const events = unfolded.split("BEGIN:VEVENT").slice(1).map((chunk) => chunk.split("END:VEVENT")[0]).map((block) => {
    const startsAt = icsDateToIso(readIcsField(block, "DTSTART"));
    const endsAt = icsDateToIso(readIcsField(block, "DTEND"));
    const details = courseDetails(readIcsField(block, "SUMMARY"));
    return {
      uid: readIcsField(block, "UID"),
      startsAt,
      endsAt,
      date: startsAt ? dateKey(startsAt) : "",
      title: details.course,
      course: details.course,
      courseType: details.courseType,
      instructor: instructorFromDescription(readIcsField(block, "DESCRIPTION"))
    };
  }).filter((event) => event.uid && event.startsAt && event.endsAt);

  const groups = new Map();
  events.forEach((event) => {
    if (!groups.has(event.date)) groups.set(event.date, []);
    groups.get(event.date).push(event);
  });
  return [...groups.values()].flatMap((day) => {
    const slots = new Map();
    day.forEach((event) => {
      const key = `${event.startsAt}|${event.endsAt}`;
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key).push(event);
    });
    return [...slots.values()].sort((left, right) => new Date(left[0].startsAt) - new Date(right[0].startsAt))
      .map((slot, index) => {
        const first = slot[0];
        if (slot.length === 1) return { ...first, sourceUids: [first.uid], lessonNumber: index + 1 };
        const courses = [...new Set(slot.map((event) => event.course))];
        const types = [...new Set(slot.map((event) => event.courseType).filter(Boolean))];
        const sameCourse = courses.length === 1;
        return {
          ...first,
          uid: `slot:${first.date}:${first.startsAt}`,
          sourceUids: slot.map((event) => event.uid),
          course: sameCourse ? first.course : "Занятие по подгруппе",
          courseType: types.length === 1 ? types[0] : "",
          title: sameCourse ? `${first.course} — по подгруппе` : `${courses.join(", ")} — по подгруппе`,
          instructor: "",
          note: "Конкретная подгруппа и преподаватель зависят от выбора языка.",
          lessonNumber: index + 1
        };
      });
  });
}

function normalize(record) {
  return {
    ...record,
    course: record.course || "Без предмета",
    courseType: record.courseType || "",
    lessonNumber: Number.isInteger(record.lessonNumber) ? record.lessonNumber : null,
    instructor: typeof record.instructor === "string" ? record.instructor.trim() : "",
    shareUrl: typeof record.shareUrl === "string" && /^https:\/\/web\.plaud\.ai\/s\/.+/.test(record.shareUrl) ? record.shareUrl : "",
    title: record.title || "Запись без названия",
    status: record.status === "ready" ? "ready" : "processing",
    topics: Array.isArray(record.topics) ? record.topics.slice(0, 4).filter(Boolean) : []
  };
}

function hasTextMatch(item) {
  const haystack = [item.course, item.title, item.summary, item.instructor, ...(item.topics || [])].join(" ").toLocaleLowerCase("ru");
  return (!state.course || item.course === state.course)
    && (!state.date || item.date === state.date || dateKey(item.startedAt) === state.date)
    && (!state.query || haystack.includes(state.query.toLocaleLowerCase("ru")));
}

function schedulePhase(event, record) {
  const now = Date.now();
  const start = new Date(event.startsAt).getTime();
  const end = new Date(event.endsAt).getTime();
  if (now < start) return { key: "upcoming", label: "Ещё не началась", message: "Пара запланирована по расписанию." };
  if (now < end) return { key: "live", label: "В процессе", message: "Пара сейчас идёт. Запись появится после синхронизации с Plaud." };
  if (record?.status === "ready") return { key: "ready", label: "Конспект готов", message: "" };
  if (record) return { key: "processing", label: "Конспект готовится", message: "Plaud ещё обрабатывает запись. Краткое содержание появится автоматически." };
  return { key: "missing", label: "Пара завершена", message: "Запись Plaud пока не найдена." };
}

function card(record, event = null) {
  const phase = event ? schedulePhase(event, record) : {
    key: record.status === "ready" ? "ready" : "processing",
    label: record.status === "ready" ? "Конспект готов" : "Конспект готовится",
    message: record.status === "ready" ? "" : "Plaud ещё обрабатывает запись. Краткое содержание появится автоматически."
  };
  const title = record?.title || event.title;
  const course = record?.course || event.course;
  const courseType = record?.courseType || event.courseType;
  const instructorValue = event?.instructor || record?.instructor || "";
  const pair = event?.lessonNumber || record?.lessonNumber;
  const meta = event
    ? `${formatTime(event.startsAt)}–${formatTime(event.endsAt)}${pair ? ` · ${pair}-я пара` : ""}`
    : `${formatTime(record.startedAt)} · ${formatDuration(record.durationSeconds)}${pair ? ` · ${pair}-я пара` : ""}`;
  const instructor = instructorValue ? `<p class="instructor">${escapeHtml(instructorValue)}</p>` : "";
  const topics = phase.key === "ready" && record?.topics?.length
    ? `<ul class="topics">${record.topics.map((topic) => `<li>${escapeHtml(topic)}</li>`).join("")}</ul>`
    : "";
  const message = [phase.message, event?.note].filter(Boolean).join(" ");
  const summary = phase.key === "ready" && record?.summary
    ? `<p class="summary">${escapeHtml(record.summary)}</p>`
    : `<p class="summary ${phase.key === "processing" ? "processing" : ""}">${escapeHtml(message || "Краткое содержание появится автоматически.")}</p>`;
  const share = record?.shareUrl
    ? `<a class="open-link" href="${escapeHtml(record.shareUrl)}" target="_blank" rel="noopener noreferrer">Открыть в Plaud ↗</a>`
    : `<span class="open-link unavailable">${event?.startsAt && new Date(event.startsAt).getTime() > Date.now() ? "Запись появится позже" : "Публичная ссылка готовится"}</span>`;
  const source = event ? "Расписание" : "Запись Plaud";
  const classes = ["card", event ? "schedule-card" : "", phase.key].filter(Boolean).join(" ");
  return `<article class="${classes}">
    <div class="card-top">
      <p class="course">${escapeHtml(course)}</p>
      ${courseType ? `<span class="type">${escapeHtml(courseType)}</span>` : ""}
    </div>
    <h3>${escapeHtml(title)}</h3>
    <p class="lesson-meta">${meta}</p>
    ${instructor}
    <span class="status ${phase.key}">${phase.label}</span>
    ${summary}
    ${topics}
    <div class="card-footer">
      <span class="duration">${source}</span>
      ${share}
    </div>
  </article>`;
}

function renderFilters() {
  const courseNames = [...state.records, ...state.schedule].map((item) => item.course).filter(Boolean);
  const dates = [...state.records.map((record) => dateKey(record.startedAt)), ...state.schedule.map((event) => event.date)];
  const courses = [...new Set(courseNames)].sort((a, b) => a.localeCompare(b, "ru"));
  const uniqueDates = [...new Set(dates)].sort().reverse();
  $("#course-filter").innerHTML = '<option value="">Все предметы</option>' + courses
    .map((course) => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`).join("");
  $("#date-jump").innerHTML = '<option value="">Все даты</option>' + uniqueDates
    .map((date) => `<option value="${date}">${escapeHtml(formatDate(dateFromKey(date)))}</option>`).join("");
}

function dayHeading(key, count, prefix = "") {
  const label = key === dateKey(new Date()) ? `Сегодня · ${formatDate(dateFromKey(key))}` : formatDate(dateFromKey(key));
  return `<div class="day-heading"><h2>${escapeHtml(prefix ? `${prefix} · ${label}` : label)}</h2><span>${count} ${pairWord(count)}</span></div>`;
}

function scheduleDay(key, events, future) {
  const cards = events.map((event) => {
    const record = [event.uid, ...(event.sourceUids || [])].map((uid) => state.recordsByUid.get(uid)).find(Boolean);
    return card(record, event);
  }).join("");
  if (!future) return `<section class="day-group today-group" id="date-${key}">${dayHeading(key, events.length)}<div class="cards">${cards}</div></section>`;
  const open = state.date === key ? " open" : "";
  return `<details class="future-day" id="date-${key}"${open}>
    <summary>${dayHeading(key, events.length, "Будущий день")}<span class="roll-icon" aria-hidden="true">⌄</span></summary>
    <div class="cards">${cards}</div>
  </details>`;
}

function render() {
  const today = dateKey(new Date());
  const filteredSchedule = state.schedule.filter(hasTextMatch);
  const scheduledUids = new Set(state.schedule.map((event) => event.uid));
  const filteredRecords = state.records.filter((record) => hasTextMatch({ ...record, date: dateKey(record.startedAt) }))
    .filter((record) => !scheduledUids.has(record.scheduleUid));

  const recordingCount = new Set(state.records.map((record) => record.plaudFileId || record.id)).size;
  $("#catalog-count").textContent = state.query || state.course || state.date
    ? `Найдено: ${filteredRecords.length} ${recordWord(filteredRecords.length)}`
    : `${recordingCount} ${recordWord(recordingCount)} · ${state.schedule.length} ${pairWord(state.schedule.length)} в ближайшие дни`;

  const scheduleGroups = new Map();
  filteredSchedule.forEach((event) => {
    if (!scheduleGroups.has(event.date)) scheduleGroups.set(event.date, []);
    scheduleGroups.get(event.date).push(event);
  });

  const sections = [];
  const todayEvents = scheduleGroups.get(today);
  if (todayEvents?.length) sections.push(scheduleDay(today, todayEvents, false));
  [...scheduleGroups.entries()].filter(([key]) => key > today).sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, events]) => sections.push(scheduleDay(key, events, true)));

  const historyGroups = new Map();
  filteredRecords.sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt)).forEach((record) => {
    const key = dateKey(record.startedAt);
    if (!historyGroups.has(key)) historyGroups.set(key, []);
    historyGroups.get(key).push(record);
  });
  [...historyGroups.entries()].forEach(([key, records]) => {
    sections.push(`<section class="day-group history-group" id="date-${key}">${dayHeading(key, records.length, "Записи")}<div class="cards">${records.map((record) => card(record)).join("")}</div></section>`);
  });

  $("#catalog").innerHTML = sections.length
    ? sections.join("")
    : '<p class="empty">По этим фильтрам занятий и записей пока нет.</p>';
}

function bindControls() {
  $("#search-input").addEventListener("input", (event) => { state.query = event.target.value.trim(); render(); });
  $("#course-filter").addEventListener("change", (event) => { state.course = event.target.value; render(); });
  $("#date-jump").addEventListener("change", (event) => { state.date = event.target.value; render(); });
}

async function start() {
  try {
    const [catalogResponse, scheduleResponse] = await Promise.all([
      fetch("data.json", { cache: "no-store" }),
      fetch("../111.ics", { cache: "no-store" })
    ]);
    if (!catalogResponse.ok || !scheduleResponse.ok) throw new Error("Source unavailable");
    const [data, ics] = await Promise.all([catalogResponse.json(), scheduleResponse.text()]);
    state.records = Array.isArray(data.records) ? data.records.map(normalize) : [];
    state.recordsByUid = new Map(state.records.filter((record) => record.scheduleUid).map((record) => [record.scheduleUid, record]));
    const today = dateKey(new Date());
    const allSchedule = parseSchedule(ics);
    const visibleDates = [...new Set(allSchedule.map((event) => event.date).filter((date) => date >= today))]
      .sort().slice(0, LOOKAHEAD_STUDY_DAYS + 1);
    state.schedule = allSchedule.filter((event) => visibleDates.includes(event.date));
    const updated = data.updatedAt ? new Intl.DateTimeFormat("ru-RU", {
      timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short"
    }).format(new Date(data.updatedAt)) : "";
    $("#catalog-updated").textContent = updated ? `записи обновлены ${updated}` : "";
    renderFilters();
    bindControls();
    render();
  } catch (_) {
    $("#catalog-count").textContent = "Расписание временно недоступно";
    $("#load-error").hidden = false;
  }
}

start();
