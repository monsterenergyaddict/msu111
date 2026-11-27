import { chromium } from 'playwright';
import { webStatePath } from './session.mjs';

export async function openWeb() {
  const browser=await chromium.launch({headless:true,chromiumSandbox:true});
  try {
    const context=await browser.newContext({storageState:webStatePath,viewport:{width:1200,height:850},timezoneId:'Europe/Moscow',permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage();
    page.setDefaultTimeout(20_000);
    return {browser,context,page,async close(){try {await context.storageState({path:webStatePath});} finally {await browser.close();}}};
  } catch {await browser.close();throw new Error('Нужно заново подключить Plaud Web.');}
}
export async function getShare(web,recording,{allowCreate=true}={}) {
  const {page}=web;
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(recording.id)) throw new Error('Неверный идентификатор записи.');
  await page.goto(`https://web.plaud.ai/file/${recording.id}`,{waitUntil:'domcontentloaded'});
  const share=page.getByText(/^Share$/).first();
  await share.waitFor({state:'visible',timeout:60_000});
  const title=await page.getByRole('textbox',{name:'Enter the file name'}).inputValue();
  if(title.trim()!==recording.title.trim()) throw new Error('Название записи не совпало. Ссылка не опубликована.');
  await share.click();
  const create=page.getByRole('button',{name:'Create link',exact:true});
  await page.getByRole('button',{name:/^(Copy link|Create link)$/}).first().waitFor();
  if(await create.isVisible()) {
    if(!allowCreate) throw new Error('У записи ещё нет публичной ссылки.');
    for(const label of ['Audio','Transcript','Summary','Highlights']) {
      const controls=await page.locator('span').filter({hasText:new RegExp(`^${label}$`)}).locator('..').filter({visible:true}).all();
      const candidates=[];
      for(const control of controls) {
        const use=control.locator('svg use');
        if(await use.count()!==1) continue;
        const icon=await use.getAttribute('xlink:href') || await use.getAttribute('href');
        if(icon?.includes('_checkbox_')) candidates.push({control,icon});
      }
      if(candidates.length!==1) {
        if(label==='Audio') throw new Error('Не удалось проверить содержимое публичной ссылки.');
        continue;
      }
      if(!candidates[0].icon.endsWith('_checkbox_checked')) await candidates[0].control.click();
    }
    await create.click();
    await page.getByRole('button',{name:'Copy link',exact:true}).waitFor();
    if(!await page.getByText(/Never expires/).first().isVisible()) throw new Error('Не удалось проверить срок публичной ссылки.');
  }
  await page.evaluate(()=>navigator.clipboard.writeText(''));
  await page.getByRole('button',{name:'Copy link',exact:true}).click();
  const url=await page.evaluate(()=>navigator.clipboard.readText());
  if(!/^https:\/\/web\.plaud\.ai\/s\/[^\s]+$/.test(url)) throw new Error('Не удалось скопировать публичную ссылку.');
  return {url,title};
}
export async function verifyShare(web,url,recording) {
  if(!/^https:\/\/web\.plaud\.ai\/s\/[^\s]+$/.test(url)) throw new Error('Некорректная публичная ссылка.');
  const anonymous=await web.browser.newContext();
  try {
    const page=await anonymous.newPage();
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30_000});
    await page.locator('iframe').first().waitFor({timeout:30_000});
    const content=page.frameLocator('iframe').first();
    if(recording.transcriptReady) {
      await content.getByRole('button',{name:'Transcript',exact:true}).waitFor();
      await content.getByRole('button',{name:'Transcript',exact:true}).click();
    }
    if(recording.summaryReady) await content.getByRole('button',{name:'Summary',exact:true}).waitFor();
    const progress=content.getByRole('slider',{name:'playback-progress'});
    await progress.waitFor();
    await content.getByTestId('full-player-play-toggle').click();
    for(let i=0;i<30;i++) {
      if(Number(await progress.getAttribute('aria-valuenow'))>0) return;
      await page.waitForTimeout(1000);
    }
    throw new Error('Аудио по публичной ссылке не воспроизводится.');
  } finally {await anonymous.close();}
}
