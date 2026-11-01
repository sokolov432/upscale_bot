import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {LaunchInvestigator} from './investigation.mjs';import {rpcEndpoints} from './rpc-config.js';
import {createInvestigationPlanner} from './investigation-ai.mjs';import {createInvestigationCache,attachArchive,markdownInvestigation,readArchive} from './investigation-io.mjs';

export async function main(args=process.argv.slice(2)){
 const value=name=>args.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
 const recipe=value('recipe')?JSON.parse(await fs.readFile(value('recipe'),'utf8')):null;
 const ca=args.find(a=>!a.startsWith('--')) || recipe?.input?.mint;
 if(!ca || args.includes('--help')){console.log('node --use-env-proxy investigate-cli.mjs CA [--creator=DEV] [--deep] [--ai] [--rpc-file=PRIVATE.json] [--memory=BACKUP.json] [--archive=REPLAY.json] [--config=CONFIG.json] [--out=REPORT.json]\nКлюч ИИ: DEVLENS_OPENAI_API_KEY (или OPENAI_API_KEY). RPC: DEVLENS_RPC_URL либо private JSON {"url":"..."}.');return ca?0:1;}
 let rpc=process.env.DEVLENS_RPC_URL;if(value('rpc-file'))rpc=JSON.parse(await fs.readFile(value('rpc-file'),'utf8')).url;
 const memory=JSON.parse(await fs.readFile(value('memory') || new URL('./web/memory-seed.json',import.meta.url),'utf8'));
 const suppliedConfig=value('config')?JSON.parse(await fs.readFile(value('config'),'utf8')):recipe?.config || {};
 const excluded=value('exclude')?.split(',').filter(Boolean) || recipe?.excludedMints || [],deep=args.includes('--deep');
 const key=process.env.DEVLENS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
 if(args.includes('--ai') && !key)throw Error('Для --ai задайте DEVLENS_OPENAI_API_KEY локально. Без --ai скрипт выполняет автоматический поиск без модели.');
 const planner=createInvestigationPlanner({key,model:process.env.DEVLENS_OPENAI_MODEL || 'gpt-4.1-mini'});
 const out=path.resolve(value('out') || 'research/investigations/'+ca+'.json');await fs.mkdir(path.dirname(out),{recursive:true});
 const io=await createInvestigationCache(new URL('./research/investigation-cache/',import.meta.url),{fresh:args.includes('--fresh')});
 const engine=new LaunchInvestigator({...io,memory,excludedMints:excluded,rpcEndpoints:rpcEndpoints(rpc),planner,config:{...(deep?{wallets:32,depth:6,walletTransactions:64,transactionBudget:640,networkBudget:1000,signaturePages:4,timeMs:420000}:{}),...suppliedConfig},progress:p=>{if(p.phase==='investigation')console.error(p.step,p.message,p.address || p.mint || '');}});
 let replay;if(value('archive'))replay=attachArchive(engine,await readArchive(value('archive')));
 const result=await engine.run(ca,{creator:value('creator') || recipe?.input?.creator});if(replay)result.replay=replay.stats();
 const serialized=JSON.stringify(result,null,2);
 // Credentials never enter a saved journal, Markdown, recipe or generated file.
 for(const secret of [rpc,key].filter(Boolean))if(serialized.includes(secret))throw Error('Отчёт отклонён: обнаружен секрет.');
 await fs.writeFile(out,serialized,{mode:0o600});await fs.writeFile(out.replace(/\.json$/,'')+'.md',markdownInvestigation(result),{mode:0o600});await fs.writeFile(out.replace(/\.json$/,'')+'.recipe.json',JSON.stringify(result.recipe,null,2),{mode:0o600});
 const runner=out.replace(/\.json$/,'')+'.run.mjs',relative=path.relative(path.dirname(runner),fileURLToPath(import.meta.url)).split(path.sep).join('/');
 const recipeName=path.basename(out.replace(/\.json$/,'')+'.recipe.json');
 await fs.writeFile(runner,`// Generated from the completed investigation; credentials stay in the environment.\nimport {fileURLToPath} from 'node:url';\nimport {main} from ${JSON.stringify(relative.startsWith('.')?relative:'./'+relative)};\nprocess.exitCode=await main(['--recipe='+fileURLToPath(new URL(${JSON.stringify('./'+recipeName)},import.meta.url)),...process.argv.slice(2)]);\n`,{mode:0o600});
 console.log(JSON.stringify({output:out,outcome:result.outcome,candidates:result.candidates.map(c=>({mint:c.mint,name:c.name,level:c.level,score:c.score})),coverage:result.coverage,ai:result.ai,replay:result.replay},null,2));return 0;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(code=>{process.exitCode=code;}).catch(()=>{console.error('Проверка не завершена. Проверьте CA, пути файлов, доступ к RPC и настройки ИИ; секреты не выводятся.');process.exitCode=1;});
