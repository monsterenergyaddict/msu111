import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalId, summarize } from './catalog.mjs';
const exec=promisify(execFile);
const binary=new URL('../node_modules/@plaud-ai/cli/dist/index.js',import.meta.url);
export async function cli(args) {
  try {
    const {stdout}=await exec(process.execPath,[binary.pathname,...args],{timeout:90_000,maxBuffer:8*1024*1024,env:{...process.env,NO_COLOR:'1',TZ:'Europe/Moscow',PLAUD_TELEMETRY_DISABLED:'1',PLAUD_NO_UPDATE_NOTIFIER:'1'}});
    return stdout.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g,'').trimEnd();
  } catch { throw new Error('Plaud CLI недоступен. Проверь подключение и срок авторизации.'); }
}
export function parseRows(text) {
  return text.split(/\r?\n/).map(line=>line.match(/^\s{2}(\S+)\s{2}(.*?)\s+(\d{4}-\d{2}-\d{2})\s+([0-9hms-]+)\s*$/)).filter(Boolean).map(m=>({id:canonicalId(m[1]),cliId:m[1],date:m[3]}));
}
export async function listIds(from,to) {
  const ids=[];
  for(let page=1;page<=1000;page++) {
    const text=await cli(['files','--page',String(page),'--page-size','100','--date-from',from,'--date-to',to]);
    const count=Number(text.match(/Files on this page:\s*(\d+)/)?.[1]);
    const rows=parseRows(text);
    if (!Number.isFinite(count) || count!==rows.length) throw new Error('Формат списка Plaud изменился. Каталог не изменён.');
    ids.push(...rows);
    if(count<100) return ids;
  }
  throw new Error('Слишком много страниц Plaud. Каталог не изменён.');
}
function duration(value) {
  return Number(value.match(/(\d+)h/)?.[1]||0)*3600+Number(value.match(/(\d+)m/)?.[1]||0)*60+Number(value.match(/(\d+)s/)?.[1]||0);
}
export async function details(id) {
  const text=await cli(['file',`of_${canonicalId(id)}`]);
  const get=name=>text.match(new RegExp(`^\\s*${name}:\\s*(.+)$`,'m'))?.[1]?.trim()||'';
  const parse=value=>Date.parse(value && !/(?:Z|[+-]\d\d:\d\d)$/i.test(value)?`${value}Z`:value);
  const startedAt=parse(get('start_at'))||parse(get('created_at'));
  const result={id:canonicalId(id),title:get('name'),startedAt,durationSeconds:duration(get('duration')),summaryReady:get('summary')==='available',transcriptReady:get('transcript')==='available'};
  if(!result.title || !Number.isFinite(startedAt)) throw new Error('Нет надёжного времени записи Plaud.');
  return result;
}
export async function material(recording) {
  if(!recording.summaryReady) return {summary:'',topics:[]};
  const text=(await cli(['summary',`of_${recording.id}`])).replace(/^\s*Summary:\s*[^\n]*\n+/i,'');
  return summarize(text);
}
