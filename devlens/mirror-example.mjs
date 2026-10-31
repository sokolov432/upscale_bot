// Re-present the same completed two-sided investigation from its second seed.
// This does not claim another live scan or invent additional relationships.
import fs from 'node:fs/promises';import {Analyzer} from './engine.mjs';
const first='57YQJbgdE32ZMCQzBivhjcXmnMLY5iw2MwrtcPYWpump',r=JSON.parse(await fs.readFile(new URL('./research/'+first+'-analysis.json',import.meta.url),'utf8'));
if(!r.comparison)throw Error('Completed comparison required');
const out=structuredClone(r),old=r.target,target=r.comparison.token;out.target=target;
for(const w of out.wallets){if(w.address===target.creator)w.role='developer';else if(w.address===old.creator)w.role='comparison';}
for(const t of out.tokens)t.relation=t.creator===target.creator?'same_creator':t.creator===old.creator?'comparison_creator':t.origin===target.creator?'funding_path':'comparison_funding';
const a=new Analyzer({limits:r.coverage.limits});for(const e of r.edges)a.edges.set(JSON.stringify(e),e);
out.comparison={...r.comparison,token:old,wallet:old.creator,directPath:a.ancestorPaths(target.creator).has(old.creator),sharedAncestors:(r.comparison.sharedAncestors || []).map(x=>({...x,firstPath:x.secondPath,secondPath:x.firstPath}))};
out.snapshot=true;out.snapshotNote='Тот же архив совместной проверки двух CA; изменена точка отсчёта. Отдельный новый скан не выполнялся.';
await fs.writeFile(new URL('./research/'+target.mint+'-analysis.json',import.meta.url),JSON.stringify(out,null,2));console.log('Mirrored verified comparison:',target.symbol);
