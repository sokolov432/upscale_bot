import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {LaunchInvestigator,assessPrevious,INVESTIGATION_DEFAULTS,cohortEvidence} from '../investigation.mjs';
import {launchProofs,acquisitions,authorityHandoffs} from '../launch-evidence.mjs';
import {readArchive,attachArchive} from '../investigation-io.mjs';import {createInvestigationPlanner} from '../investigation-ai.mjs';
const fixture=n=>new URL('./fixtures/investigation/'+n+'.json.gz',import.meta.url);
const memory=JSON.parse(await fs.readFile(new URL('../web/memory-seed.json',import.meta.url),'utf8'));
const GLASS='DwdiS94nXvBzQJSYNSRjdAUMK9BJ7sxeXMXfQxVM95Vg',SH='9MhyrmteMknv7tvNixSj7kiHyYA2hNSiB1TfPc2Nrsxj',BOUNCER='6SsWu1LfJtHq7XikR3o1qWobHMxkAWEupXp7qCqKpump',PRIME='258BdyhLNqntRuK51fsNHJWW2jV8FPVrLrB3xvgBpump',VICE='CjQ494q5yYfbHMoEpXdbi6mrS5sd3Norx8VEDUwgkXZR',GTA='4kjruqGHDsSqkMdFfCjV7Vb62HPFhtXyWc2t6JpQzDnz';
async function replay(name,mint,options={}){const a=await readArchive(fixture(name)),q=new LaunchInvestigator({memory,...options}),io=attachArchive(q,a);return {q,r:await q.run(mint),archive:a,replay:io.stats()};}
test('GLASS discovers and re-verifies SH through an observed cohort without the saved answer or review labels',async()=>{
 const clean={cases:memory.cases.filter(c=>c.mint!==GLASS),links:[]},{r}=await replay('glass',GLASS,{memory:clean});const c=r.candidates.find(c=>c.mint===SH);assert.equal(c.level,'strong_candidate');assert.equal(c.protocol,'meteora_dbc');assert.equal(c.identityEstablished,false);assert.equal(c.evidence.find(e=>e.family==='early_cohort').wallets.length,6);assert(r.target.launch);assert(!JSON.stringify(r.recipe).includes('user_confirmed_launch_group'));
});
test('BOUNCER rediscovers PRIME from signed creations and funding; no accepted previous CA is fed to the engine',async()=>{
 const {r}=await replay('bouncer',BOUNCER,{memory:{cases:[],links:[]}}),c=r.candidates.find(c=>c.mint===PRIME);assert(c);assert.equal(c.launch.proof,'program_create_event');assert(c.evidence.some(e=>e.family==='program_authority'));assert(c.evidence.some(e=>e.family==='synchronized_consolidation'));assert.equal(c.identityEstablished,false);
 const early=r.early.find(e=>e.mint===BOUNCER).rows;assert(early.some(e=>e.index>=297),'real first acquisitions are far beyond the four immediate block neighbours');assert(!r.candidates.some(c=>c.mint==='HB2tiJ1TGEASPAGdjqY9jdGjPfmQprqxCYisguDtpump'));
});
test('VICE authenticates Token-2022 LaunchLab birth and excludes an earlier purchased reference asset',async()=>{
 const {r}=await replay('vice',VICE);assert.equal(r.target.launch.protocol,'raydium_launchlab');assert.equal(r.outcome,'no_supported_candidate_in_checked_scope');assert(!r.candidates.some(c=>c.mint===GTA));assert(r.limitations.some(l=>l.includes('checked scope')));
});
test('same operator only qualifies with two verified, chronological launches',()=>{
 const actor=memory.cases[0].creator,target={mint:GLASS,launch:{actor,time:200,source:'https://solscan.io/tx/current'}},candidate={mint:SH,launch:{actor,time:100,source:'https://solscan.io/tx/previous'}},base={target,candidate};assert.equal(assessPrevious(base).score,100);assert.equal(assessPrevious({...base,target:{mint:GLASS}}).level,'unverified');assert.equal(assessPrevious({...base,candidate:{...candidate,launch:{...candidate.launch,time:300}}}).reason,'not_earlier_than_current_launch');assert.equal(assessPrevious({...base,services:new Set([actor])}).level,'weak');
});
test('a common exchange or an ordinary acquired token cannot become a previous launch',()=>{
 const [a,b,hub]=memory.cases.map(c=>c.creator).filter((v,i,a)=>a.indexOf(v)===i),target={mint:GLASS,launch:{actor:a,time:300}},candidate={mint:SH,launch:{actor:b,time:100}},edges=[{kind:'funding',from:hub,to:a,time:200},{kind:'funding',from:hub,to:b,time:90}];assert.equal(assessPrevious({target,candidate,edges,services:new Set([hub])}).level,'weak');assert.equal(assessPrevious({target,candidate:{mint:SH}}).reason,'launch_not_verified');assert.equal(assessPrevious({target,candidate:{...candidate,mint:GTA}}).reason,'reference_or_quote_asset');
});
test('read-only target balances and wrong program IDs do not manufacture launches or early buyers',async()=>{
 const a=await readArchive(fixture('glass')),entry=Object.entries(a.responses).find(([k,v])=>k.startsWith('rpc:getTransaction') && launchProofs(v.result,'s').some(p=>p.mint===GLASS)),tx=structuredClone(entry[1].result);for(const i of tx.transaction.message.instructions)if(i.programId==='LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj')i.programId='11111111111111111111111111111111';assert(!launchProofs(tx,'s').some(p=>p.mint===GLASS));for(const k of tx.transaction.message.accountKeys)k.signer=false;assert.deepEqual(acquisitions(tx,GLASS,null,'s',0,1),[]);
});
test('one generic buyer is weak even if its trading history contains the token',()=>{
 const actor=memory.cases[0].creator,target={mint:GLASS,launch:{actor,time:200}},candidate={mint:SH,launch:{actor:memory.cases[1].creator,time:100}},early=[{wallet:actor,order:1,coSigners:[],signature:'s'}];assert.equal(cohortEvidence(early,early).shared.length,1);assert.equal(assessPrevious({target,candidate,currentEarly:early,previousEarly:early}).level,'weak');
});
test('an incomplete archive is a coverage limitation and cannot report a completed negative search',async()=>{
 const a=await readArchive(fixture('glass'));for(const k of Object.keys(a.responses))if(k.startsWith('rpc:getTransaction'))delete a.responses[k];const q=new LaunchInvestigator({memory:{cases:[],links:[]}});attachArchive(q,a);const r=await q.run(GLASS);assert.equal(r.outcome,'current_launch_unverified');assert.equal(r.candidates.length,0);assert(r.limitations.includes('source_unavailable'));
});
test('the AI planner cannot invent an action or refer to a non-existent fact',async()=>{
 const packet={actions:[{id:'a1'}],facts:[{id:'step1'}]},request=async()=>new Response(JSON.stringify({output_text:JSON.stringify({actionIds:['open_unknown_wallet'],reason:'x',evidenceIds:['step1']})}));const planner=createInvestigationPlanner({key:'test-local-key',request});await assert.rejects(()=>planner(packet),/ненаблюдавшиеся/);
 let body;const good=createInvestigationPlanner({key:'test-local-key',request:async(u,o)=>{body=JSON.parse(o.body);return new Response(JSON.stringify({output_text:JSON.stringify({actionIds:['a1'],reason:'Проверить создание',evidenceIds:['step1']})}));}});assert.deepEqual((await good(packet)).actionIds,['a1']);assert.equal(body.store,false);assert(!JSON.stringify(body).includes('test-local-key'));
});
test('the action executor rejects AI actions outside its pending queue',async()=>{
 const q=new LaunchInvestigator({planner:async()=>({actionIds:['evil'],reason:'x'})});q.target={mint:GLASS};q.schedule('verify_token',{mint:SH},1,'test');q.schedule('inspect_wallet',{address:memory.cases[0].creator,depth:1},1,'test');await q.plan();assert.equal(q.journal.at(-1).result.state,'rejected_unobserved_action');assert.equal(q.pending.length,2);
});
test('a 429 stops the investigation instead of continuing with fallback requests',async()=>{
 let calls=0;const q=new LaunchInvestigator({request:async()=>{calls++;return new Response('{}',{status:429});}}),r=await q.run(GLASS,{creator:memory.cases[0].creator});assert.equal(calls,1);assert.equal(r.coverage.stopped,'rate_limited');assert.equal(r.candidates.length,0);
});
test('concurrent transaction reservation respects the total request budget',async()=>{
 const q=new LaunchInvestigator({config:{transactionBudget:2}});let calls=0;q.rpc=async()=>{calls++;return {meta:{err:null}};};await Promise.all(['one','two','three','four'].map(signature=>q.transaction({signature})));assert.equal(calls,2);assert.equal(q.transactions.size,2);assert.equal(q.stopped,'transaction_budget');
});
test('a user rejection is honoured without using confirmed pairs as discovery answers',async()=>{
 const {r}=await replay('glass',GLASS,{memory:{cases:memory.cases,links:[{a:GLASS,b:SH,decision:'rejected'}]}});assert(!r.candidates.some(c=>c.mint===SH));assert(r.recipe.excludedMints.includes(SH));
});
test('when the registry is unavailable, a supported birth supplies the operator rather than an arbitrary fee payer',async()=>{
 const archive=await readArchive(fixture('glass')),entry=Object.entries(archive.responses).find(([k,v])=>k.startsWith('rpc:getTransaction') && launchProofs(v.result,'s').some(p=>p.mint===GLASS)),tx=entry[1].result,signature=tx.transaction.signatures[0],proof=launchProofs(tx,signature)[0];const q=new LaunchInvestigator({memory:{cases:[],links:[]}});attachArchive(q,archive);q.coin=async()=>{throw Error('Registry unavailable');};q.findMintBirth=async()=>({target:{createdAt:tx.blockTime*1000},launch:{row:{signature,slot:tx.slot},tx}});const r=await q.run(GLASS);assert.equal(r.target.launch.actor,proof.actor);assert.equal(r.target.creator,proof.actor);
});
