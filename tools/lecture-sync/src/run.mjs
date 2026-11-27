import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cli,listIds,details,material } from './cli.mjs';
import { parseSchedule,chooseAssignments,mergeRecording,validateCatalog,canonicalId,dayOf } from './catalog.mjs';
import { openWeb,getShare,verifyShare } from './web.mjs';
import { privateDir } from './session.mjs';
const root=process.env.GITHUB_WORKSPACE || new URL('../../',import.meta.url).pathname;
const catalogPath=join(root,'site/lectures/data.json');
const checkpointsPath=join(privateDir,'checkpoints.json');
const write=process.argv.includes('--write');
const pilot=process.argv.find(a=>a.startsWith('--pilot='))?.slice(8);
let web;
try {
  await cli(['me']);
  const catalog=validateCatalog(JSON.parse(await readFile(catalogPath,'utf8')));
  const original=JSON.stringify(catalog);
  const events=parseSchedule(await readFile(join(root,'site/111.ics'),'utf8'));
  if(!events.length) throw new Error('Расписание не прочитано.');
  await mkdir(privateDir,{recursive:true,mode:0o700});
  let checkpoints={};
  try {checkpoints=JSON.parse(await readFile(checkpointsPath,'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
  const today=dayOf(Date.now());
  const previousSync=Date.parse(catalog.updatedAt);
  const from=process.env.PLAUD_FROM || dayOf(Math.min(Date.now()-14*86400_000,Number.isFinite(previousSync)?previousSync-86400_000:Date.parse('2026-09-01T00:00:00+03:00')));
  const rows=pilot ? [{id:canonicalId(pilot)}] : await listIds(from,today);
  // Older unfinished cards are retried even after they leave the date window.
  const pending=catalog.records.filter(r=>r.plaudFileId && !r.supersededBy && r.status!=='cancelled' && (!r.shareUrl || r.status==='processing'));
  const ids=[...new Set([...rows.map(r=>r.id),...(!pilot?pending.map(r=>canonicalId(r.plaudFileId)):[])])];
  const stats={checked:0,matched:0,published:0,pending:0,ambiguous:0};
  const recordings=[];
  for(const id of ids) recordings.push(await details(id));
  const assignments=chooseAssignments(recordings,events);
  for(const recording of recordings) {
    const id=recording.id;stats.checked++;
    const existing=catalog.records.filter(r=>canonicalId(r.plaudFileId)===id && !r.supersededBy);
    if(existing.length && existing.every(r=>r.status==='ready' && r.shareUrl)) continue;
    const targets=assignments.get(id).filter(target=>{
      const record=catalog.records.find(r=>!r.supersededBy && (target.manual ? r.source==='manual' && canonicalId(r.plaudFileId)===id : r.scheduleUid===target.uid));
      return !record || record.status!=='cancelled' && (!record.plaudFileId || canonicalId(record.plaudFileId)===id);
    });
    if(!targets.length) {stats.ambiguous++;continue;}
    stats.matched++;
    // Never recreate a link removed from a previously published card.
    if(checkpoints[id]?.published && !existing.some(r=>r.shareUrl===checkpoints[id].url)) {stats.ambiguous++;continue;}
    const note=await material(recording);
    if(!note.summary) stats.pending++;
    if(!write) continue;
    web ||= await openWeb();
    let share=existing.find(r=>r.shareUrl)?.shareUrl || checkpoints[id]?.url;
    if(!share) {
      const result=await getShare(web,recording);share=result.url;
      checkpoints[id]={url:share,published:false};
      // Persist a created link before verification so retries reuse it.
      await writeFile(checkpointsPath,JSON.stringify(checkpoints),{mode:0o600});
    }
    await verifyShare(web,share,recording);
    mergeRecording(catalog,recording,targets,note,share);
    checkpoints[id]={url:share,published:checkpoints[id]?.published || false};
    stats.published++;
  }
  if(write && JSON.stringify(catalog)!==original) {
    catalog.updatedAt=new Date().toISOString();
    validateCatalog(catalog);
    await writeFile(catalogPath,JSON.stringify(catalog,null,2)+'\n');
  }
  // Only the workflow marks checkpoints published, after a successful push.
  if(write) await writeFile(checkpointsPath,JSON.stringify(checkpoints),{mode:0o600});
  console.log(JSON.stringify({mode:write?'write':'dry-run',...stats}));
} catch {
  console.error('Обновление не завершено. Проверь авторизацию Plaud, доступ к публичным ссылкам и формат расписания. Старый каталог сохраняется в GitHub.');
  process.exitCode=1;
} finally {await web?.close().catch(()=>{process.exitCode=1;});}
