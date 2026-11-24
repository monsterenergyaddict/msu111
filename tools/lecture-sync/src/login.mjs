import { spawn } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { privateDir,webStatePath,saveSession } from './session.mjs';
import { join } from 'node:path';
process.umask(0o077);
await mkdir(privateDir,{recursive:true,mode:0o700});
// The official CLI performs OAuth and manages its own token file.
const cli=new URL('../node_modules/@plaud-ai/cli/dist/index.js',import.meta.url).pathname;
const code=await new Promise(resolve=>{
  const child=spawn(process.execPath,[cli,'login'],{stdio:'inherit',env:{...process.env,PLAUD_TELEMETRY_DISABLED:'1',PLAUD_NO_UPDATE_NOTIFIER:'1'}});
  child.on('exit',resolve);child.on('error',()=>resolve(1));
});
if(code!==0) process.exit(1);
console.log('Теперь войди в Plaud Web в открывшемся окне. Оставь окно открытым до сообщения о готовности.');
const browser=await chromium.launch({headless:false,chromiumSandbox:true});
try {
  const context=await browser.newContext({viewport:{width:1200,height:850},timezoneId:'Europe/Moscow'});
  const page=await context.newPage();
  await page.goto('https://web.plaud.ai/',{waitUntil:'domcontentloaded'});
  await page.getByText('Personal workspace',{exact:true}).first().waitFor({timeout:10*60_000});
  await context.storageState({path:webStatePath});
  process.env.PLAUD_SESSION_KEY=randomBytes(32).toString('hex');
  const path=join(privateDir,'bootstrap.enc');
  await saveSession(path);
  await writeFile(join(privateDir,'session-key.txt'),process.env.PLAUD_SESSION_KEY,{mode:0o600});
  console.log(`Подключение сохранено в защищённой папке ${privateDir}. Не добавляй её в GitHub.`);
} finally {await browser.close();}
