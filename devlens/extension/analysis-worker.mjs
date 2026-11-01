import {Analyzer} from './engine.mjs';
import {rpcEndpoints} from './rpc-config.js';
import {QuickProfiler} from './quick.mjs';
const jobs=new Map(),requests=new Map();
function requestFor(jobId){return (url,options={})=>new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID();const abort=()=>{requests.delete(requestId);postMessage({type:'fetch-cancel',requestId,id:jobId});reject(new DOMException('Cancelled','AbortError'));};
  if(options.signal?.aborted){abort();return;}
  options.signal?.addEventListener('abort',abort,{once:true});
  requests.set(requestId,{resolve:r=>{options.signal?.removeEventListener('abort',abort);resolve(r);},reject:e=>{options.signal?.removeEventListener('abort',abort);reject(e);}});
  postMessage({type:'fetch',requestId,id:jobId,url,method:options.method || 'GET',body:options.body});
});}
onmessage=async({data:m})=>{
  if(m.type==='fetch-result'){const request=requests.get(m.requestId);if(!request)return;requests.delete(m.requestId);if(m.reply?.error)request.reject(Error(m.reply.error));else request.resolve(new Response(m.reply.body,{status:m.reply.status,headers:m.reply.headers}));return;}
  if(m.type==='cancel'){jobs.get(m.id)?.abort();return;}
  if(m.type!=='analyze' || jobs.has(m.id))return;
  const controller=new AbortController();jobs.set(m.id,controller);
  if(m.quick){try{const q=new QuickProfiler({request:requestFor(m.id),rpcEndpoints:rpcEndpoints(m.customRpcURL),signal:controller.signal,progress:progress=>postMessage({type:'progress',id:m.id,progress})});const preview=await q.preview(m.ca);postMessage({type:'profile',id:m.id,...preview});}catch(e){postMessage({type:'error',id:m.id,error:e.name==='AbortError'?'Проверка остановлена.':e.message});}finally{jobs.delete(m.id);}return;}
  try{const a=new Analyzer({request:requestFor(m.id),rpcEndpoints:rpcEndpoints(m.customRpcURL),signal:controller.signal,limits:m.deep?{depth:10,wallets:24,transactions:64,rootTransactions:128,peerWallets:12,transactionBudget:640}:{rootTransactions:64,peerWallets:6},progress:progress=>postMessage({type:'progress',id:m.id,progress})});const result=await a.run(m.ca,{comparison:m.comparison});postMessage({type:'result',id:m.id,result});}
  catch(e){postMessage({type:'error',id:m.id,error:e.name==='AbortError'?'Проверка остановлена.':e.message});}
  finally{jobs.delete(m.id);}
};
