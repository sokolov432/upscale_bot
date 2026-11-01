import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {LaunchInvestigator,assessPrevious,INVESTIGATION_DEFAULTS} from './investigation.mjs';
import {readArchive,attachArchive} from './investigation-io.mjs';

export function evaluateExamples(reports,examples,config){
 const checks=[];
 for(const example of examples){const r=reports.find(r=>r.exampleId===example.id);if(!r)continue;
  const services=new Set(r.wallets.filter(w=>w.service).map(w=>w.address)),excluded=new Set(r.recipe.excludedMints),raw=Object.values(r.calibrationCandidates || {});
  const candidates=raw.map(candidate=>assessPrevious({target:r.target,candidate,edges:r.edges,coSignatures:r.coSignatures,currentEarly:r.early.find(e=>e.mint===r.target.mint)?.rows,previousEarly:r.early.find(e=>e.mint===candidate.mint)?.rows,services,excluded,config:{...INVESTIGATION_DEFAULTS,...config}}));
  for(const expected of example.expect){const actual=candidates.find(c=>c.mint===expected.mint),found=actual && ['candidate','strong_candidate'].includes(actual.level);const pass=expected.label==='excluded_reference_asset'?!found:expected.label==='user_confirmed_launch_group'?actual?.level==='strong_candidate':!!found;
   checks.push({example:example.id,fold:example.fold,mint:expected.mint,label:expected.label,pass,actual:actual?.level || 'not_returned'});
  }
 }return {checks,calibrationPassed:checks.filter(c=>c.fold==='calibration' && c.pass).length,calibrationTotal:checks.filter(c=>c.fold==='calibration').length,negativeControlPassed:checks.filter(c=>c.fold==='negative_control' && c.pass).length};
}
export async function calibrate({manifest=new URL('./calibration/examples.json',import.meta.url),output=new URL('./research/calibration/',import.meta.url)}={}){
 manifest=manifest instanceof URL?manifest:pathToFileURL(path.resolve(manifest));output=output instanceof URL?output:pathToFileURL(path.resolve(output)+path.sep);const spec=JSON.parse(await fs.readFile(manifest,'utf8')),memory=JSON.parse(await fs.readFile(new URL('./web/memory-seed.json',import.meta.url),'utf8')),reports=[];
 for(const example of spec.examples){const archive=await readArchive(new URL(example.archive,manifest)),engine=new LaunchInvestigator({memory}),replay=attachArchive(engine,archive),report=await engine.run(example.mint);report.exampleId=example.id;report.replay=replay.stats();report.calibrationCandidates=Object.fromEntries(engine.candidates);reports.push(report);}
 const grid=[];for(const candidateThreshold of [15,20,30])for(const strongThreshold of [55,60,70,80]){const config={candidateThreshold,strongThreshold},evaluation=evaluateExamples(reports,spec.examples,config);grid.push({config,evaluation,distance:Math.abs(candidateThreshold-20)+Math.abs(strongThreshold-60)});}
 // Only calibration labels select settings; the negative control is reported
 // afterwards and unknown outputs are not silently labelled as false positives.
 grid.sort((a,b)=>b.evaluation.calibrationPassed-a.evaluation.calibrationPassed || a.distance-b.distance);const chosen=grid[0];
 const summary={version:1,at:new Date().toISOString(),selectedConfig:chosen.config,evaluation:chosen.evaluation,settingsTried:grid.length,networkRequests:0,examples:reports.map(r=>({id:r.exampleId,outcome:r.outcome,candidates:r.candidates.map(c=>({mint:c.mint,level:c.level,score:c.score})),coverage:r.coverage,replay:r.replay})),limitations:['Three known examples calibrate workflow behaviour, not predictive accuracy.','BOUNCER / PRIME is an unconfirmed funding hypothesis, not a confirmed common owner.','VICE supplies one excluded asset; the actual previous token remains unknown.','Archives have missing requests and explicitly report those gaps.','AI API behaviour and a cold live run are not evaluated by offline calibration.']};
 await fs.mkdir(output,{recursive:true});await fs.writeFile(new URL('selected-config.json',output),JSON.stringify(chosen.config,null,2));await fs.writeFile(new URL('report.json',output),JSON.stringify(summary,null,2));return summary;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))calibrate().then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error('Калибровка не завершена: проверьте архивы примеров.');process.exitCode=1;});
