import {addressFromInput} from './engine.mjs';
import {PUBLIC_RPC_ENDPOINTS,READ_RPC_METHODS,normalizeRpcURL} from './rpc-config.js';
// Long analysis runs in an offscreen document's real worker, outside the
// five-minute lifetime of a single MV3 service-worker event.
const jobs=new Map(),network=new Map();let opening;
async function ensureWorker(){
  if(await chrome.offscreen.hasDocument())return;
  if(!opening)opening=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS'],justification:'Проверка публичной истории и декодирование on-chain событий в отдельном worker без блокировки интерфейса.'}).finally(()=>opening=null);
  await opening;
}
chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='devlens')return;
  const url=new URL(port.sender?.url || 'about:blank');if(!((url.origin==='https://sokolov432.github.io' && url.pathname.startsWith('/upscale_bot/')) || ['http://localhost:4318','http://127.0.0.1:4318'].includes(url.origin))){port.disconnect();return;}
  let id;
  port.onDisconnect.addListener(()=>{if(id){jobs.delete(id);chrome.runtime.sendMessage({target:'devlens-offscreen',type:'cancel',id}).catch(()=>{});}});
  port.onMessage.addListener(async m=>{
    if(m.type==='open-settings'){chrome.runtime.openOptionsPage();return;}
    if(m.type==='cancel' && m.id===id){chrome.runtime.sendMessage({target:'devlens-offscreen',type:'cancel',id}).catch(()=>{});return;}
    if(m.type!=='analyze')return;
    if(id || jobs.size>=2){port.postMessage({type:'error',id:m.id,error:'Проверка уже идёт. Остановите её или дождитесь результата.'});return;}
    try{addressFromInput(m.ca);if(m.comparison)addressFromInput(m.comparison);if(typeof m.id!=='string' || m.id.length>100)throw Error('Некорректный запрос.');}
    catch(e){port.postMessage({type:'error',id:m.id,error:e.message});return;}
    id=m.id;jobs.set(id,{port,done:()=>id=null});
    try{const saved=await chrome.storage.local.get('customRpcURL');let customRpcURL=normalizeRpcURL(saved.customRpcURL);if(customRpcURL && !await chrome.permissions.contains({origins:[new URL(customRpcURL).origin+'/*']}))customRpcURL=null;jobs.get(id).customRpcURL=customRpcURL;await ensureWorker();await chrome.runtime.sendMessage({target:'devlens-offscreen',type:'analyze',id,ca:m.ca,comparison:m.comparison,deep:m.deep,customRpcURL});}
    catch(e){jobs.delete(id);port.postMessage({type:'error',id,error:'Не удалось запустить расширение: '+e.message});id=null;}
  });
});
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(m.target==='devlens-network'){
    if(sender.url!==chrome.runtime.getURL('offscreen.html'))return;
    if(m.type==='fetch-cancel'){network.get(m.requestId)?.abort();network.delete(m.requestId);respond({cancelled:true});return;}
    if(m.type!=='fetch' || !jobs.has(m.id))return;
    try{
      const u=new URL(m.url),method=m.method || 'GET';
      const pump=u.origin==='https://frontend-api-v3.pump.fun' && method==='GET' && /^\/coins-v2\/(?:user-created-coins\/)?[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(u.pathname);
      const body=m.body?JSON.parse(m.body):null;
      const allowed=PUBLIC_RPC_ENDPOINTS.some(e=>e.url===u.href) || jobs.get(m.id)?.customRpcURL===u.href;
      const rpc=allowed && method==='POST' && READ_RPC_METHODS.has(body?.method);
      if(!pump && !rpc)throw Error('Разрешены только публичные запросы чтения Pump.fun и Solana RPC.');
      const controller=new AbortController();network.set(m.requestId,controller);
      fetch(u.href,{method,credentials:'omit',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]),...(rpc?{headers:{'Content-Type':'application/json'},body:m.body}:{})}).then(async r=>respond({status:r.status,headers:Object.fromEntries(['content-type','retry-after','x-degraded'].map(k=>[k,r.headers.get(k)]).filter(([,v])=>v!==null)),body:await r.text()})).catch(e=>respond({error:String(e)})).finally(()=>network.delete(m.requestId));
      return true;
    }catch(e){respond({error:String(e)});return;}
  }
  if(m.target!=='devlens-background')return;
  const job=jobs.get(m.id);if(!job)return;
  try{job.port.postMessage(m);}catch{}
  if(['result','error'].includes(m.type)){jobs.delete(m.id);job.done();if(m.type==='result')chrome.storage.local.set({lastResult:m.result}).catch(()=>{});setTimeout(async()=>{if(!jobs.size && await chrome.offscreen.hasDocument() && !jobs.size)chrome.offscreen.closeDocument().catch(()=>{});},15000);}
});
