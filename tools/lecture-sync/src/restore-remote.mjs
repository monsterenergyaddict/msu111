import { writeFile,mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { privateDir,restoreSession } from './session.mjs';
const exec=promisify(execFile);
const repo=process.env.GITHUB_REPOSITORY;
const token=process.env.GITHUB_TOKEN;
async function api(path,binary=false) {
  const response=await fetch(`https://api.github.com/repos/${repo}/${path}`,{headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30_000)});
  if(!response.ok) throw new Error('GitHub state unavailable');
  return binary?Buffer.from(await response.arrayBuffer()):response.json();
}
try {
  await mkdir(privateDir,{recursive:true,mode:0o700});
  let artifact;
  for(let page=1;page<=10 && !artifact;page++) {
    const result=await api(`actions/artifacts?name=plaud-session-v1&per_page=100&page=${page}`);
    for(const candidate of result.artifacts || []) {
      if(candidate.expired || candidate.workflow_run?.head_branch!=='main') continue;
      const run=await api(`actions/runs/${candidate.workflow_run.id}`);
      if(run.path==='.github/workflows/plaud-sync.yml' && run.event!=='pull_request') {artifact=candidate;break;}
    }
    if((result.artifacts||[]).length<100) break;
  }
  const path=join(privateDir,'restore.enc');
  if(artifact) {
    const zip=join(privateDir,'session.zip');
    await writeFile(zip,await api(`actions/artifacts/${artifact.id}/zip`,true),{mode:0o600});
    const {stdout}=await exec('unzip',['-p',zip,'session.enc'],{encoding:'buffer',maxBuffer:16*1024*1024});
    await writeFile(path,stdout,{mode:0o600});
  } else {
    if(!process.env.PLAUD_BOOTSTRAP) throw new Error('Missing seed');
    await writeFile(path,Buffer.from(process.env.PLAUD_BOOTSTRAP,'base64'),{mode:0o600});
  }
  await restoreSession(path);
  console.log('Зашифрованное подключение Plaud восстановлено.');
} catch {
  console.error('Подключение Plaud не восстановлено. Проверь секреты и срок хранения состояния.');
  process.exitCode=1;
}
