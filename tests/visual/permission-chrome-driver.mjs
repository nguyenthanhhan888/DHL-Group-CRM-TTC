// Chrome CDP driver for an isolated QA profile. Never attaches to a user session.
import {spawn} from 'node:child_process';
import {readFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
export async function startChrome(){
const profile=await mkdtemp(join(tmpdir(),'dhl-permission-uat-'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const apiErrors=[];
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });
let ws;
const pending = new Map();
let nextId = 0;
let sessionId;
const errors = [];
const dialogs = [];
const results = [];
function cdp(method, params = {}, session = sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text + ': ' + response.exceptionDetails.exception?.description);
  return response.result.value;
}
async function until(expression){for(let n=0;n<160;n++){if(await evaluate(expression))return;await pause(50);}throw Error(`UI timeout ${expression}; ${JSON.stringify({errors,apiErrors,body:await evaluate('document.body.innerText')})}`);}
async function click(selector){await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing control');node.scrollIntoView({block:'nearest'});node.click();})()`);}

let portFile;
for(let n=0;n<100;n++){try{portFile=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await pause(100);}}
if(!portFile){chrome.kill('SIGTERM');throw Error('Chrome unavailable');}
ws=new WebSocket(`ws://127.0.0.1:${portFile[0]}${portFile[1]}`);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}if(m.method==='Page.javascriptDialogOpening')dialogs.push(m.params);if(m.method==='Runtime.exceptionThrown')errors.push({name:'browser',message:m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text});};
const target=await cdp('Target.createTarget',{url:'about:blank'},null);
sessionId=(await cdp('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
await cdp('Runtime.enable');await cdp('Page.enable');
return {cdp,evaluate,until,click,errors,dialogs,pause,async close(){if(ws?.readyState===1){try{await cdp('Browser.close',{},null);}catch{}ws.close();}chrome.kill('SIGTERM');}};
}
