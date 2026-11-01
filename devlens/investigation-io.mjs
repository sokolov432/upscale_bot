import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {SourceError,READ_RPC_METHODS} from './rpc-config.js';
import {gunzipSync} from 'node:zlib';

export async function readArchive(file){const bytes=await fs.readFile(file);return JSON.parse((String(file).endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8'));}

export const requestKey=(url,body)=>body?'rpc:'+body.method+':'+JSON.stringify(body.params):'get:'+url;
export async function createInvestigationCache(directory,{fresh=false,request=fetch}={}){
 directory=directory instanceof URL?fileURLToPath(directory):directory;
 await fs.mkdir(directory,{recursive:true});
 const file=(u,b)=>path.join(directory,crypto.createHash('sha256').update(requestKey(u,b)).digest('hex')+'.json');
 async function cachedRead(u,b){if(fresh)return undefined;try{const d=JSON.parse(await fs.readFile(file(u,b),'utf8'));const immutable=b && ['getTransaction','getBlock'].includes(b.method),ttl=immutable?Infinity:b?60000:300000;if(d.version!==1 || Date.now()-d.at>ttl)return undefined;return d.value;}catch{return undefined;}}
 async function wrapped(u,o={}){const b=o.body?JSON.parse(o.body):null;if(b && !READ_RPC_METHODS.has(b.method))throw Error('Разрешены только read-only RPC методы.');const r=await request(u,o);if(r.ok){const d=await r.clone().json().catch(()=>null);if(d && !d.error)await fs.writeFile(file(u,b),JSON.stringify({version:1,at:Date.now(),value:d}),{mode:0o600});}return r;}
 return {request:wrapped,cachedRead};
}
export function attachArchive(investigator,archive){
 if(archive.version!==1 || !archive.responses || typeof archive.responses!=='object')throw Error('Нужен архив проверок версии 1.');
 let reads=0,misses=0;const used=new Set();
 const read=(url,body)=>{reads++;const key=requestKey(url,body),value=archive.responses[key];used.add(key);if(value===undefined){misses++;throw new SourceError('Запрос отсутствует в архиве.',{kind:'archive_miss'});}return structuredClone(value);};
 investigator.get=async(url,body)=>read(url,body);
 investigator.rpc=async(method,params)=>{if(!READ_RPC_METHODS.has(method))throw Error('Read-only RPC only.');const d=read('',{method,params});if(d.error)throw new SourceError('Ошибка в архивном RPC.',{kind:'rpc_error'});return d.result;};
 return {stats:()=>({mode:'archive_replay',reads,misses,networkRequests:0}),usedKeys:()=>[...used]};
}
export function markdownInvestigation(r){
 const out=['# Предыдущие запуски', '',`Текущий CA: \`${r.target.mint}\``, `Результат: ${r.outcome}`, ''];
 if(!r.candidates.length)out.push('Подтверждённого кандидата в проверенной области не найдено. Это не доказывает отсутствие прежних запусков.','');
 for(const c of r.candidates){out.push(`## ${c.name || c.symbol || c.mint}`, '',`CA: \`${c.mint}\``, `Уровень: ${c.level}; балл сортировки: ${c.score} (не вероятность).`,`Запуск: ${new Date(c.createdAt).toISOString()}`,`[Создание](${c.launch.source})`,'');for(const e of c.evidence)out.push('- '+e.label+': '+e.sources.map(s=>`[tx](${s})`).join(' '));out.push('');}
 out.push('## Покрытие','', '```json',JSON.stringify(r.coverage,null,2),'```','',`ИИ: ${r.ai.state}.`, '', 'Общий человек-владелец разных адресов не установлен. Торговые и привязанные активы не считаются предыдущими запусками.','',...r.limitations.map(l=>'- '+l));return out.join('\n')+'\n';
}
