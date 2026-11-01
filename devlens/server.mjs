import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {Analyzer,addressFromInput} from './engine.mjs';
import {QuickProfiler} from './quick.mjs';import {rpcEndpoints} from './rpc-config.js';
const root=path.resolve(fileURLToPath(new URL('./web/',import.meta.url))),port=Number(process.env.DEVLENS_PORT || 4318);let active=0;
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(req.method==='POST' && req.url==='/api/quick'){
    if(req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin)){res.writeHead(403);res.end();return;}
    if(active>=2){res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Проверка уже выполняется.'}));return;}
    let entered=false;const controller=new AbortController();res.on('close',()=>controller.abort());try{let raw='';for await(const c of req){raw+=c;if(raw.length>4096)throw Error('Слишком большой запрос.');}const body=JSON.parse(raw);addressFromInput(body.ca);active++;entered=true;const q=new QuickProfiler({signal:controller.signal,rpcEndpoints:rpcEndpoints(process.env.DEVLENS_RPC_URL)}),data=await q.preview(body.ca);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}catch(e){if(!res.destroyed){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}}finally{if(entered)active--;}return;
  }
  if(req.method==='POST' && req.url==='/api/analyze'){
    if(req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin)){res.writeHead(403);res.end();return;}
    if(active>=2){res.writeHead(429);res.end('Проверка уже выполняется.');return;}
    let raw='';try{for await(const c of req){raw+=c;if(raw.length>4096)throw Error('Слишком большой запрос.');}const b=JSON.parse(raw);addressFromInput(b.ca);if(b.comparison)addressFromInput(b.comparison);
      active++;res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store'});const controller=new AbortController();res.on('close',()=>controller.abort());
      const emit=x=>{if(!res.destroyed)res.write(JSON.stringify(x)+'\n');};
      try{const a=new Analyzer({signal:controller.signal,progress:progress=>emit({type:'progress',progress}),limits:b.deep?{depth:10,wallets:24,transactions:64,rootTransactions:128,peerWallets:12,transactionBudget:640}:{}});const result=await a.run(b.ca,{comparison:b.comparison});emit({type:'result',result});}catch(e){emit({type:'error',error:e.message});}finally{active--;res.end();}
    }catch(e){if(!res.headersSent)res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end(e.message);}return;
  }
  if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end('Invalid URL');return;}
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,''),file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.zip':'application/zip'})[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404);res.end('Not found');}
});server.listen(port,'127.0.0.1',()=>console.log(`DevLens: http://127.0.0.1:${port}`));
