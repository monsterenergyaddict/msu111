import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const privateDir = process.env.PLAUD_PRIVATE_DIR || fileURLToPath(new URL('../.private/', import.meta.url));
export const webStatePath = join(privateDir,'web-state.json');
export const cliTokensPath = join(homedir(),'.plaud','tokens.json');
function keyBytes(key) {
  if (!/^[a-f\d]{64}$/i.test(key || '')) throw new Error('PLAUD_SESSION_KEY must contain 64 hex characters');
  return Buffer.from(key,'hex');
}
export function encrypt(value,key) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',keyBytes(key),iv);
  const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([Buffer.from('MSU1'),iv,cipher.getAuthTag(),body]);
}
export function decrypt(buffer,key) {
  if (buffer.subarray(0,4).toString()!=='MSU1') throw new Error('Invalid session envelope');
  const cipher=createDecipheriv('aes-256-gcm',keyBytes(key),buffer.subarray(4,16));
  cipher.setAuthTag(buffer.subarray(16,32));
  return JSON.parse(Buffer.concat([cipher.update(buffer.subarray(32)),cipher.final()]).toString('utf8'));
}
export async function saveSession(path) {
  let checkpoints={};
  try {checkpoints=JSON.parse(await readFile(join(privateDir,'checkpoints.json'),'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
  const session={tokens:JSON.parse(await readFile(cliTokensPath,'utf8')),web:JSON.parse(await readFile(webStatePath,'utf8')),checkpoints};
  await writeFile(path,encrypt(session,process.env.PLAUD_SESSION_KEY),{mode:0o600});
}
export async function restoreSession(path) {
  const session=decrypt(await readFile(path),process.env.PLAUD_SESSION_KEY);
  if (!session.tokens?.access_token || !Array.isArray(session.web?.cookies) || !Array.isArray(session.web?.origins)) throw new Error('Incomplete session');
  await mkdir(join(homedir(),'.plaud'),{recursive:true,mode:0o700});
  await mkdir(privateDir,{recursive:true,mode:0o700});
  await writeFile(cliTokensPath,JSON.stringify(session.tokens),{mode:0o600});
  await writeFile(webStatePath,JSON.stringify(session.web),{mode:0o600});
  await writeFile(join(privateDir,'checkpoints.json'),JSON.stringify(session.checkpoints || {}),{mode:0o600});
}
if (process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2]==='restore') await restoreSession(process.argv[3]);
    else if (process.argv[2]==='save') await saveSession(process.argv[3]);
    else if (process.argv[2]==='mark-published') {
      const catalog=JSON.parse(await readFile(process.argv[3],'utf8'));
      const path=join(privateDir,'checkpoints.json');
      let checkpoints={};
      try {checkpoints=JSON.parse(await readFile(path,'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
      for(const record of catalog.records) {
        if(record.plaudFileId && record.shareUrl && !record.supersededBy) checkpoints[String(record.plaudFileId).replace(/^of_/,'')]={url:record.shareUrl,published:true};
      }
      await writeFile(path,JSON.stringify(checkpoints),{mode:0o600});
    }
    else throw new Error('Expected restore or save');
  } catch { console.error('Не удалось прочитать или сохранить зашифрованное подключение Plaud.'); process.exitCode=1; }
}
