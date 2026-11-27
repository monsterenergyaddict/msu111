import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRecording,chooseAssignments,parseSchedule,mergeRecording,summarize,validateCatalog } from '../src/catalog.mjs';
import { encrypt,decrypt } from '../src/session.mjs';
import { parseRows } from '../src/cli.mjs';
const start=Date.parse('2026-11-20T09:00:00+03:00');
const lesson={uid:'first',start,end:start+90*60_000,course:'Логика',courseType:'Лекция',lessonNumber:1,instructor:'Иванов Иван Иванович'};
const recording={id:'test-recording',title:'Логика',startedAt:start+3*60_000,durationSeconds:34*60};
const now=start+24*3600_000;
test('short lecture recordings qualify with five minutes of overlap',()=>{
  assert.equal(matchRecording(recording,[lesson],now)[0].uid,'first');
  assert.deepEqual(matchRecording({...recording,durationSeconds:120},[lesson],now),[]);
});
test('future, ambiguous and excluded events are never published',()=>{
  assert.deepEqual(matchRecording(recording,[lesson],start),[]);
  assert.deepEqual(matchRecording(recording,[lesson,{...lesson,uid:'parallel'}],now),[]);
  assert.deepEqual(matchRecording(recording,[{...lesson,course:'Английский язык'}],now),[]);
});
test('late uploads use explicit date and pair, rather than upload time',()=>{
  const late={...recording,startedAt:start+86400_000,title:'20.11 1 пара Логика'};
  assert.equal(matchRecording(late,[lesson],now)[0].uid,'first');
  assert.deepEqual(matchRecording({...late,title:'19.11 Логика'},[lesson],now),[]);
});
test('manual lecture names work outside the timetable',()=>{
  assert.equal(matchRecording({...recording,title:'Лекция: [Логика] Аристотель'},[],now)[0].course,'Логика');
  assert.deepEqual(matchRecording({...recording,title:'Лекция: [Английский язык] Тест'},[],now),[]);
});
test('a file for two consecutive lessons creates two assignments only when explicit',()=>{
  const second={...lesson,uid:'second',start:lesson.end+15*60_000,end:lesson.end+105*60_000,lessonNumber:2};
  const long={...recording,startedAt:start,durationSeconds:190*60,title:'Логика две пары'};
  assert.equal(matchRecording(long,[lesson,second],now).length,2);
  assert.equal(matchRecording({...long,title:'Логика'},[lesson,second],now).length,1);
});
test('competing recordings choose longest overlap before order of retrieval',()=>{
  const better={...recording,id:'better',durationSeconds:85*60};
  for(const order of [[recording,better],[better,recording]]) {
    const chosen=chooseAssignments(order,[lesson],now);
    assert.equal(chosen.get('better').length,1);assert.equal(chosen.get(recording.id).length,0);
  }
});
test('ICS metadata uses Moscow time and slot numbers, with folded descriptions',()=>{
  const ics='BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:first\r\nDTSTART;TZID=Europe/Moscow:20261120T090000\r\nDTEND;TZID=Europe/Moscow:20261120T103000\r\nSUMMARY:Логика [Лекция]\r\nDESCRIPTION:ауд. 1\\nИванов Иван\r\n  Иванович\r\nEND:VEVENT\r\nEND:VCALENDAR';
  const [event]=parseSchedule(ics);
  assert.equal(event.start,start);assert.equal(event.lessonNumber,1);assert.equal(event.course,'Логика');assert.equal(event.instructor,'Иванов Иван Иванович');
});
test('merging is repeatable, preserves old cards and manual text',()=>{
  const catalog={records:[{id:'existing',scheduleUid:'first',startedAt:new Date(start).toISOString(),course:'Логика',title:'Мой заголовок',summary:'Моя правка',topics:['Моя тема'],status:'processing'}]};
  const note={summary:'Новый конспект.',topics:['Новая тема']};
  mergeRecording(catalog,recording,[lesson],note,'https://web.plaud.ai/s/public-test');
  assert.equal(catalog.records.length,1);assert.equal(catalog.records[0].summary,'Моя правка');assert.equal(catalog.records[0].title,'Мой заголовок');
  const before=JSON.stringify(catalog);
  mergeRecording(catalog,recording,[lesson],note,'https://web.plaud.ai/s/public-test');
  assert.equal(JSON.stringify(catalog),before);
});
test('cancelled and already assigned cards are preserved',()=>{
  for(const patch of [{status:'cancelled'},{plaudFileId:'other-recording'}]) {
    const catalog={records:[{id:'existing',scheduleUid:'first',...patch}]};
    const before=JSON.stringify(catalog);
    mergeRecording(catalog,recording,[lesson],{summary:'Конспект',topics:[]},'https://web.plaud.ai/s/test');
    assert.equal(JSON.stringify(catalog),before);
  }
});
test('private recording URLs cannot enter the catalog',()=>{
  assert.throws(()=>mergeRecording({records:[]},recording,[lesson],{},'https://web.plaud.ai/file/private'));
  assert.throws(()=>validateCatalog({records:[{id:'a'},{id:'a'}]}));
});
test('encrypted state authenticates contents and never exposes tokens',()=>{
  const key='ab'.repeat(32),state={tokens:{access_token:'PRIVATE_TOKEN'},web:{cookies:[],origins:[]}};
  const sealed=encrypt(state,key);
  assert.equal(sealed.includes(Buffer.from('PRIVATE_TOKEN')),false);
  assert.deepEqual(decrypt(sealed,key),state);
  assert.throws(()=>decrypt(sealed,'cd'.repeat(32)));
  const altered=Buffer.from(sealed);altered[altered.length-1]^=1;
  assert.throws(()=>decrypt(altered,key));
});
test('CLI table parsing keeps full of_ IDs and handles blank names',()=>{
  const rows=parseRows('  of_abcdefghijklmnopqrstuvwxyz12345678  Лекция                               2026-11-20    1h30m\n  abcdefghijklmnopqrstuvwxyz12345678                                        2026-11-19    34m30s');
  assert.equal(rows.length,2);assert.equal(rows[0].id,'abcdefghijklmnopqrstuvwxyz12345678');
});
test('summary remains bounded and never publishes raw HTML',()=>{
  const result=summarize('<p>Первое предложение. Второе предложение. Третье предложение. Четвёртое предложение. Пятое предложение.</p>\n- Тема первая\n- Тема вторая');
  assert.equal(result.summary.includes('<p>'),false);assert.equal(result.summary.includes('Пятое'),false);assert.ok(result.topics.length<=4);
});
