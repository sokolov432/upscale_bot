// Private working catalogue for investigations in this workspace. It is never
// copied into docs/ or an extension package. Use a browser backup to exchange it.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeBackup,normalizeCase,mergeCases,KnowledgeIndex} from './knowledge.mjs';
const defaultFile=new URL('./research/token-memory.json',import.meta.url);
export async function readMemory(file=defaultFile){try{return normalizeBackup(JSON.parse(await fs.readFile(file,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;return {version:1,cases:[],links:[]};}}
export async function remember(values,file=defaultFile){
 const book=await readMemory(file),records=new Map(book.cases.map(c=>[c.mint,c]));
 const incoming=Array.isArray(values)?{cases:values,links:[]}:normalizeBackup(values);
 for(const value of incoming.cases){const c=normalizeCase(value);records.set(c.mint,mergeCases(records.get(c.mint),c));}
 const links=new Map(book.links.map(l=>[l.id,l]));for(const link of incoming.links){const old=links.get(link.id);if(!old || old.updatedAt<=link.updatedAt)links.set(link.id,link);}
 const out={version:1,exportedAt:new Date().toISOString(),cases:[...records.values()],links:[...links.values()]},target=file instanceof URL?fileURLToPath(file):file;
 await fs.mkdir(path.dirname(target),{recursive:true});const temporary=target+'.tmp';await fs.writeFile(temporary,JSON.stringify(out,null,2),{mode:0o600});await fs.rename(temporary,target);return out;
}
export async function lookup(ca,file=defaultFile){const book=await readMemory(file),index=new KnowledgeIndex(book.cases,book.links),known=index.cases.get(ca);return {known:known || null,matches:known?index.search(known):[],count:index.cases.size};}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,input]=process.argv.slice(2);
 try{if(command==='lookup')console.log(JSON.stringify(await lookup(input),null,2));
 else if(command==='remember'){const value=JSON.parse(await fs.readFile(input,'utf8'));const out=await remember(Array.isArray(value) || value.cases?value:[value]);console.log(JSON.stringify({savedCases:out.cases.length}));}
 else console.log('node memory-cli.mjs lookup CA | remember PRIVATE_CASE_OR_BACKUP.json');}catch{console.error('Не удалось прочитать или сохранить приватную базу.');process.exitCode=1;}
}
