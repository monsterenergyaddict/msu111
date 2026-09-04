const TIME_ZONE = "Europe/Moscow";
const $ = (selector) => document.querySelector(selector);

const state = { records: [], query: "", course: "", date: "" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function dateParts(value, options) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, ...options }).formatToParts(new Date(value));
}

function part(value, type) {
  return dateParts(value, { year: "numeric", month: "2-digit", day: "2-digit" })
    .find((item) => item.type === type)?.value || "";
}

function dateKey(value) {
  const bits = Object.fromEntries(dateParts(value, { year: "numeric", month: "2-digit", day: "2-digit" })
    .filter((item) => ["year", "month", "day"].includes(item.type)).map((item) => [item.type, item.value]));
  return `${bits.year}-${bits.month}-${bits.day}`;
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

function normalize(record) {
  return {
    ...record,
    course: record.course || "Без предмета",
    courseType: record.courseType || "",
    title: record.title || "Запись без названия",
    status: record.status === "ready" ? "ready" : "processing",
    topics: Array.isArray(record.topics) ? record.topics.slice(0, 4).filter(Boolean) : []
  };
}

function matches(record) {
  const haystack = [record.course, record.title, record.summary, ...(record.topics || [])].join(" ").toLocaleLowerCase("ru");
  return (!state.course || record.course === state.course)
    && (!state.date || dateKey(record.startedAt) === state.date)
    && (!state.query || haystack.includes(state.query.toLocaleLowerCase("ru")));
}

function card(record) {
  const ready = record.status === "ready";
  const status = ready ? "Конспект готов" : "Конспект готовится";
  const topics = ready && record.topics.length
    ? `<ul class="topics">${record.topics.map((topic) => `<li>${escapeHtml(topic)}</li>`).join("")}</ul>`
    : "";
  const summary = ready && record.summary
    ? `<p class="summary">${escapeHtml(record.summary)}</p>`
    : '<p class="summary processing">Plaud ещё обрабатывает запись. Краткое содержание появится автоматически.</p>';
  return `<article class="card">
    <div class="card-top">
      <p class="course">${escapeHtml(record.course)}</p>
      ${record.courseType ? `<span class="type">${escapeHtml(record.courseType)}</span>` : ""}
    </div>
    <h3>${escapeHtml(record.title)}</h3>
    <p class="lesson-meta">${formatTime(record.startedAt)} · ${formatDuration(record.durationSeconds)}</p>
    <span class="status ${record.status}">${status}</span>
    ${summary}
    ${topics}
    <div class="card-footer">
      <span class="duration">Запись Plaud</span>
      <a class="open-link" href="${escapeHtml(record.plaudUrl)}" target="_blank" rel="noopener noreferrer">Открыть в Plaud ↗</a>
    </div>
  </article>`;
}

function renderFilters() {
  const courses = [...new Set(state.records.map((record) => record.course))].sort((a, b) => a.localeCompare(b, "ru"));
  const dates = [...new Set(state.records.map((record) => dateKey(record.startedAt)))].sort().reverse();
  $("#course-filter").innerHTML = '<option value="">Все предметы</option>' + courses
    .map((course) => `<option value="${escapeHtml(course)}">${escapeHtml(course)}</option>`).join("");
  $("#date-jump").innerHTML = '<option value="">Все даты</option>' + dates
    .map((date) => `<option value="${date}">${escapeHtml(formatDate(`${date}T12:00:00+03:00`))}</option>`).join("");
}

function render() {
  const records = state.records.filter(matches).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  $("#catalog-count").textContent = records.length === state.records.length
    ? `${records.length} ${records.length === 1 ? "запись" : "записей"}`
    : `Найдено: ${records.length}`;
  if (!records.length) {
    $("#catalog").innerHTML = '<p class="empty">По этим фильтрам записей пока нет.</p>';
    return;
  }
  const groups = new Map();
  records.forEach((record) => {
    const key = dateKey(record.startedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  $("#catalog").innerHTML = [...groups.entries()].map(([key, dayRecords]) => `<section class="day-group" id="date-${key}">
    <div class="day-heading"><h2>${escapeHtml(formatDate(dayRecords[0].startedAt))}</h2><span>${dayRecords.length} ${dayRecords.length === 1 ? "запись" : "записи"}</span></div>
    <div class="cards">${dayRecords.map(card).join("")}</div>
  </section>`).join("");
}

function bindControls() {
  $("#search-input").addEventListener("input", (event) => { state.query = event.target.value.trim(); render(); });
  $("#course-filter").addEventListener("change", (event) => { state.course = event.target.value; render(); });
  $("#date-jump").addEventListener("change", (event) => { state.date = event.target.value; render(); });
}

async function start() {
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Catalog unavailable");
    const data = await response.json();
    state.records = Array.isArray(data.records) ? data.records.map(normalize) : [];
    const updated = data.updatedAt ? new Intl.DateTimeFormat("ru-RU", {
      timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short"
    }).format(new Date(data.updatedAt)) : "";
    $("#catalog-updated").textContent = updated ? `обновлено ${updated}` : "";
    renderFilters();
    bindControls();
    render();
  } catch (_) {
    $("#catalog-count").textContent = "Каталог временно недоступен";
    $("#load-error").hidden = false;
  }
}

start();
