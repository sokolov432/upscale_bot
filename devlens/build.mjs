import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';
const root=new URL('../docs/',import.meta.url),web=new URL('./web/',import.meta.url),pack=new URL('./dist/extension/',import.meta.url);
await fs.mkdir(pack,{recursive:true});await fs.mkdir(root,{recursive:true});
for(const name of await fs.readdir(new URL('./extension/',import.meta.url)))await fs.copyFile(new URL('./extension/'+name,import.meta.url),new URL(name,pack));
await fs.copyFile(new URL('./engine.mjs',import.meta.url),new URL('engine.mjs',pack));
await fs.copyFile(new URL('./rpc-config.js',import.meta.url),new URL('rpc-config.js',pack));
await fs.copyFile(new URL('./rpc-config.js',import.meta.url),new URL('rpc-config.js',web));
await fs.copyFile(new URL('./engine.mjs',import.meta.url),new URL('engine.js',web));
await fs.mkdir(new URL('snapshots/',web),{recursive:true});
for(const ca of ['57YQJbgdE32ZMCQzBivhjcXmnMLY5iw2MwrtcPYWpump','EM4ai7j5hLiK3qY1f68awyoQ1Jaq3a6DVz6L6KNFpump','DZrVCDqSyUBFoFJWJCVELhzL4cTFYWpCMirnv91TTTSH']){
  try{const r=JSON.parse(await fs.readFile(new URL('./research/'+ca+'-analysis.json',import.meta.url),'utf8'));await fs.writeFile(new URL('snapshots/'+ca+'.json',web),JSON.stringify(r));}catch(e){if(e.code!=='ENOENT')throw e;console.warn('Snapshot pending:',ca);}
}
execFileSync('python',['-c','import pathlib,zipfile; p=pathlib.Path("dist/extension"); z=zipfile.ZipFile("web/devlens-extension.zip","w",zipfile.ZIP_DEFLATED); [(lambda i,f: z.writestr(i,f.read_bytes()))(zipfile.ZipInfo(str(f.relative_to(p)),date_time=(2026,1,1,0,0,0)),f) for f in sorted(p.rglob("*")) if f.is_file()]; z.close()'],{cwd:new URL('./',import.meta.url)});
for(const name of await fs.readdir(web)){await fs.cp(new URL(name,web),new URL(name,root),{recursive:true});}
await fs.writeFile(new URL('.nojekyll',root),'');console.log('Built docs/ + devlens/dist/extension/');
