// Compact already-captured public mainnet fixtures; never makes a network call.
// Run from devlens/: node tools/project-investigation-archives.mjs
import fs from 'node:fs/promises';import {gzipSync} from 'node:zlib';
import {LaunchInvestigator} from '../investigation.mjs';import {readArchive,attachArchive} from '../investigation-io.mjs';
const manifest=new URL('../calibration/examples.json',import.meta.url),spec=JSON.parse(await fs.readFile(manifest,'utf8')),memory=JSON.parse(await fs.readFile(new URL('../web/memory-seed.json',import.meta.url),'utf8'));
for(const example of spec.examples){
 const file=new URL(example.archive,manifest),archive=await readArchive(file),q=new LaunchInvestigator({memory}),io=attachArchive(q,archive);await q.run(example.mint);
 const needed=new Set(io.usedKeys()),responses=Object.fromEntries(Object.entries(archive.responses).filter(([key])=>needed.has(key)));
 const mints=new Set([q.target.mint,...q.candidates.keys()]);
 for(const [key,value] of Object.entries(responses))if(key.startsWith('rpc:getBlock:') && value.result?.transactions){
  // Preserve the full original positions and every target-mint balance. Omit
  // unrelated programs/logs only, after checking the original balance records.
  value.result.archiveProjection={mintBalances:[...mints],transactionPositionsPreserved:true,unrelatedInstructionsOmitted:true};
  value.result.transactions=value.result.transactions.map(t=>{
   if([...(t.meta?.preTokenBalances || []),...(t.meta?.postTokenBalances || [])].some(b=>mints.has(b.mint)))return t;
   return {transaction:{signatures:t.transaction.signatures,message:{accountKeys:t.transaction.message.accountKeys,instructions:[]}},meta:{err:t.meta?.err,preTokenBalances:[],postTokenBalances:[]}};
  });
 }
 const body={version:1,source:archive.source,projection:'Only requests used by the default workflow; absent requests remain unknown. Blocks retain positions and all investigated mint balances. Unrelated instructions are omitted.',responses};
 await fs.writeFile(file,gzipSync(JSON.stringify(body)));console.log(example.id,Object.keys(responses).length,(await fs.stat(file)).size);
}
