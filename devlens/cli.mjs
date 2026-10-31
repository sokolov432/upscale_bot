import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Analyzer} from './engine.mjs';
const folder=new URL('./research/',import.meta.url),args=process.argv.slice(2),ca=args.find(a=>!a.startsWith('--'));
if(!ca){console.error('node --use-env-proxy cli.mjs CA [--compare=CA] [--deep] [--fresh]');process.exit(1);}
const fresh=args.includes('--fresh');await fs.mkdir(new URL('./research/cache/',import.meta.url),{recursive:true});
async function request(url,options={}){
  const body=options.body?JSON.parse(options.body):null;const hash=crypto.createHash('sha256').update(url+JSON.stringify(body || null)).digest('hex');const file=new URL('./research/cache/'+hash+'.json',import.meta.url);
  if(!fresh){
    const seed=body?.method==='getTransaction'?body.params[0]+'.json':body?.method==='getSignaturesForAddress' && !body.params[1].before?body.params[0]+'-signatures.json':url.includes('user-created-coins/') && url.includes('offset=0')?url.split('user-created-coins/')[1].split('?')[0]+'-coins.json':url.includes('/coins-v2/')?url.split('/coins-v2/')[1]+'.json':null;
    for(const f of [file,...(seed?[new URL(seed,folder)]:[])]){try{const value=JSON.parse(await fs.readFile(f,'utf8'));if(value?.error)continue;return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});}catch{}}
  }
  const response=await fetch(url,options);if(response.ok){try{const value=await response.clone().json();if(!value?.error)await fs.writeFile(file,JSON.stringify(value));}catch{}}
  return response;
}
async function cachedRead(url,body){if(fresh)return undefined;const response=await requestCachedOnly(url,body);return response;}
async function requestCachedOnly(url,body){
  const hash=crypto.createHash('sha256').update(url+JSON.stringify(body || null)).digest('hex');
  const seed=body?.method==='getTransaction'?body.params[0]+'.json':body?.method==='getSignaturesForAddress' && !body.params[1].before?body.params[0]+'-signatures.json':url.includes('user-created-coins/') && url.includes('offset=0')?url.split('user-created-coins/')[1].split('?')[0]+'-coins.json':url.includes('/coins-v2/')?url.split('/coins-v2/')[1]+'.json':null;
  for(const f of [new URL('./research/cache/'+hash+'.json',import.meta.url),...(seed?[new URL(seed,folder)]:[])]){try{const d=JSON.parse(await fs.readFile(f,'utf8'));if(!d?.error)return d;}catch{}}
}
const deep=args.includes('--deep'),comparison=args.find(a=>a.startsWith('--compare='))?.slice(10);
const analyzer=new Analyzer({request,cachedRead,progress:p=>console.error(p.phase,p.message),limits:deep?{depth:10,wallets:24,transactions:64,rootTransactions:128,peerWallets:12,transactionBudget:640}:{}});
const result=await analyzer.run(ca,{comparison});result.snapshot=true;result.snapshotNote='Архив проверки; новые CA проверяются расширением или локальным сервером.';
const output=args.find(a=>a.startsWith('--out='))?.slice(6) || 'research/'+ca+'-analysis.json';await fs.writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify({output,tokens:result.tokens.map(t=>({symbol:t.symbol,mint:t.mint,creator:t.creator,relation:t.relation})),coverage:result.coverage,comparison:result.comparison},null,2));
