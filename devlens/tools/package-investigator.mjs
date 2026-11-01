import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url),dest=new URL('../research/investigator-package/',import.meta.url);
await fs.mkdir(dest,{recursive:true});
for(const name of ['investigate-cli.mjs','investigation.mjs','investigation-ai.mjs','investigation-io.mjs','launch-evidence.mjs','calibrate.mjs','quick.mjs','engine.mjs','solana.mjs','knowledge.mjs','rpc-config.js','ai.mjs','calibration/examples.json','web/memory-seed.json','test/investigation.test.mjs','test/fixtures/investigation']){await fs.mkdir(new URL('./'+name.split('/').slice(0,-1).join('/')+'/',dest),{recursive:true});await fs.cp(new URL(name,root),new URL(name,dest),{recursive:true});}
await fs.copyFile(new URL('README_INVESTIGATOR.md',root),new URL('README.md',dest));
await fs.writeFile(new URL('package.json',dest),JSON.stringify({name:'devlens-investigator',version:'1.0.0',private:true,type:'module',engines:{node:'>=20'},scripts:{investigate:'node investigate-cli.mjs',calibrate:'node calibrate.mjs',test:'node --test test/*.test.mjs'}},null,2));
execFileSync('python',['-c','import pathlib,zipfile; p=pathlib.Path("research/investigator-package"); z=zipfile.ZipFile("research/devlens-investigator.zip","w",zipfile.ZIP_DEFLATED); [(lambda i,f: z.writestr(i,f.read_bytes()))(zipfile.ZipInfo(str(f.relative_to(p)),date_time=(2026,1,1,0,0,0)),f) for f in sorted(p.rglob("*")) if f.is_file()]; z.close()'],{cwd:root});
console.log('research/devlens-investigator.zip');
