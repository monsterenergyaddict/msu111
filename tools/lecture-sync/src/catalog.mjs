export const canonicalId = value => String(value || '').replace(/^of_/, '');
const excluded = value => /английский язык|немецкий язык|французский язык|иностранный язык|физическая культура|межфакультетский учебный курс/iu.test(value);
const unescapeIcs = value => String(value || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
export const dayOf = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

function icsTime(value) {
  const m = value?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  return m ? Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]) - (m[7] ? 0 : 3*3600_000) : NaN;
}
export function parseSchedule(text) {
  const events = (text.replace(/\r?\n[ \t]/g, '').match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || []).map(block => {
    const fields = Object.fromEntries(block.split(/\r?\n/).map(line => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).split(';')[0], line.slice(colon+1)];
    }));
    const start = icsTime(fields.DTSTART), end = icsTime(fields.DTEND);
    const title = unescapeIcs(fields.SUMMARY).replace(/^дв(?=[А-ЯЁ])/u, '');
    const course = title.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
    const instructor = unescapeIcs(fields.DESCRIPTION).split('\n').map(s=>s.trim()).filter(s=>/^[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+$/u.test(s)).join(', ');
    return { uid: fields.UID, start, end, course, courseType: title.match(/\[([^\]]+)\]\s*$/)?.[1] || '', instructor };
  }).filter(e => e.uid && Number.isFinite(e.start) && e.end > e.start).sort((a,b)=>a.start-b.start);
  const days = new Map();
  for (const e of events) {
    const key = dayOf(e.start);
    if (!days.has(key)) days.set(key, [...new Set(events.filter(x=>dayOf(x.start)===key).map(x=>x.start))]);
    e.lessonNumber = days.get(key).indexOf(e.start)+1;
  }
  return events;
}
export function matchRecording(recording, events, now = Date.now()) {
  const manual = recording.title.match(/^Лекция:\s*\[([^\]]+)\]\s*(.*)$/iu);
  if (manual) return excluded(manual[1]) ? [] : [{ manual: true, course: manual[1].trim(), title: manual[2].trim() || manual[1].trim() }];
  let candidates = events.filter(e=>e.end<=now && !excluded(e.course));
  const date = recording.title.match(/(?:^|\D)(\d{1,2})\.(\d{1,2})(?:\.(20\d{2}))?(?:\D|$)/);
  const dashed = !date && recording.title.match(/^(\d{2})-(\d{2})(?:\s|$)/);
  const explicitDay = date ? `${date[3] || dayOf(recording.startedAt).slice(0,4)}-${date[2].padStart(2,'0')}-${date[1].padStart(2,'0')}` : dashed ? `${dayOf(recording.startedAt).slice(0,4)}-${dashed[1]}-${dashed[2]}` : '';
  const pair = recording.title.match(/(?:^|\D)([1-8])\s*(?:пара|пары)(?:\D|$)/iu);
  if (explicitDay || pair) {
    candidates = candidates.filter(e=>dayOf(e.start)===(explicitDay || dayOf(recording.startedAt)));
    if (pair) candidates = candidates.filter(e=>e.lessonNumber===+pair[1]);
    // An explicit day alone is insufficient when several lessons took place.
    if (candidates.length===1) return candidates;
    const time = recording.title.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s|$)/);
    if (time) candidates = candidates.filter(e=>new Date(e.start+3*3600_000).toISOString().slice(11,16)===`${time[1].padStart(2,'0')}:${time[2]}`);
    if (time) return candidates.length===1 ? candidates : [];
    if (explicitDay && dayOf(recording.startedAt)!==explicitDay) return [];
  }
  const end = recording.startedAt + recording.durationSeconds*1000;
  const ranked = candidates.map(e=>({e, overlap: Math.max(0, Math.min(end,e.end)-Math.max(recording.startedAt,e.start)), distance:Math.abs(recording.startedAt-e.start)}))
    .filter(x=>x.overlap>=5*60_000).sort((a,b)=>b.overlap-a.overlap || a.distance-b.distance);
  if (/две\s+пары/iu.test(recording.title) && ranked.length===2) {
    const both=ranked.map(x=>x.e).sort((a,b)=>a.start-b.start);
    return both[0].end<=both[1].start && both[1].start-both[0].end<=45*60_000 ? both : [];
  }
  if (!ranked.length || ranked[1] && ranked[0].overlap===ranked[1].overlap && ranked[0].distance===ranked[1].distance) return [];
  return [ranked[0].e];
}
export function chooseAssignments(recordings,events,now=Date.now()) {
  const winners=new Map();
  const assignments=new Map();
  const score=(recording,target)=>[
    Math.max(0,Math.min(recording.startedAt+recording.durationSeconds*1000,target.end)-Math.max(recording.startedAt,target.start)),
    -Math.abs(recording.startedAt-target.start),recording.durationSeconds
  ];
  const compare=(a,b)=>{for(let i=0;i<a.length;i++) {if(a[i]!==b[i]) return a[i]-b[i];}return 0;};
  for(const recording of recordings) {
    const targets=matchRecording(recording,events,now);assignments.set(recording.id,targets);
    for(const target of targets) {
      if(target.manual) continue;
      const previous=winners.get(target.uid);
      if(!previous || compare(score(recording,target),score(previous,target))>0) winners.set(target.uid,recording);
    }
  }
  for(const [id,targets] of assignments) assignments.set(id,targets.filter(t=>t.manual || winners.get(t.uid)?.id===id));
  return assignments;
}
export function summarize(markdown) {
  const clean = markdown.replace(/<[^>]*>/g,'').replace(/\*\*/g,'').replace(/^#{1,6}\s+/gm,'').trim();
  const paragraphs = clean.split(/\n\s*\n/).map(s=>s.replace(/\s+/g,' ').trim()).filter(s=>s.length>50 && !/^[-*|]/.test(s));
  const prose = paragraphs.join(' ') || clean.replace(/\s+/g,' ');
  const sentences = prose.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return { summary: sentences.slice(0,4).join(' ').trim().slice(0,1200), topics: [...new Set(clean.split('\n').filter(s=>/^\s*[-*•]\s+/.test(s)).map(s=>s.replace(/^\s*[-*•]\s+/,'').trim()).filter(s=>s.length>8 && s.length<140))].slice(0,4) };
}
export function validateCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.records)) throw new Error('Invalid catalog');
  const ids = new Set();
  for (const record of catalog.records) {
    if (!record.id || ids.has(record.id)) throw new Error('Duplicate or missing catalog id');
    ids.add(record.id);
  }
  return catalog;
}
export function mergeRecording(catalog, recording, targets, material, shareUrl) {
  validateCatalog(catalog);
  const url = new URL(shareUrl);
  if (url.protocol!=='https:' || url.hostname!=='web.plaud.ai' || !url.pathname.startsWith('/s/') || url.username || url.password || url.port) throw new Error('Invalid public share');
  const now = new Date().toISOString();
  for (const target of targets) {
    let record = catalog.records.find(r=>!r.supersededBy && (target.manual ? canonicalId(r.plaudFileId)===recording.id && r.source==='manual' : r.scheduleUid===target.uid));
    if (record?.status==='cancelled' || record?.plaudFileId && canonicalId(record.plaudFileId)!==recording.id || record?.shareUrl && record.shareUrl!==shareUrl) continue;
    if (!record) {
      record = { id: target.manual ? `plaud:${recording.id}` : `plaud:${recording.id}:${target.uid}`, plaudFileId: recording.id, source: target.manual?'manual':'schedule', startedAt: new Date(recording.startedAt).toISOString(), durationSeconds: recording.durationSeconds, course: target.course, courseType: target.courseType || '', title: target.title || recording.title, status:'processing', summary:'', topics:[] };
      if (!target.manual) Object.assign(record, {scheduleUid:target.uid, scheduledStartsAt:new Date(target.start).toISOString(),lessonNumber:target.lessonNumber,instructor:target.instructor});
      catalog.records.push(record);
    }
    const before=JSON.stringify(record);
    record.plaudFileId=recording.id;
    record.shareUrl ||= shareUrl;
    if(!target.manual) {
      record.lessonNumber ??= target.lessonNumber;
      record.instructor ||= target.instructor;
      record.scheduledStartsAt ||= new Date(target.start).toISOString();
    }
    if (material.summary && record.status!=='ready') {
      if (!record.summary || /^Занятие добавлено из расписания\./.test(record.summary)) record.summary=material.summary;
      if (!record.topics?.length) record.topics=material.topics;
      record.status='ready';
    }
    if (before!==JSON.stringify(record)) record.updatedAt=now;
  }
  return catalog;
}
