import test from 'node:test';import assert from 'node:assert/strict';
import {KnowledgeIndex,normalizeCase,mergeCases} from '../knowledge.mjs';
import {splitMemoryReply,promptMemory,enrichMetadata} from '../case-library.mjs';
const CA='7Ad8WyDQRgUwYFg4bWTp4jxhuXaJEKEDtrXU8peoqqXw',OLD='BPGA2Yg7sqNkWXzUnsWGpVjCkD6sSVBQDyvgDQJepump',CREATOR='H95LimAz4QrZDimxDi4GbQykX8t3NTcpHJhrnA338vrQ';
const chart={hash:'0123456789abcdef',timeframe:'5m',source:'https://axiom.trade/meme/'+CA,capturedAt:1000,preview:'data:image/jpeg;base64,YWJj'};
test('chart fingerprints compare only known matching timeframes and remain weak; snapshots merge without erasure',()=>{
 const old=normalizeCase({mint:OLD,charts:[chart]}),q=normalizeCase({mint:CA,charts:[{...chart,capturedAt:2000}]});
 const hit=new KnowledgeIndex([old]).search(q)[0];assert.equal(hit.level,'weak');assert.equal(hit.identityEstablished,false);assert.equal(hit.evidence[0].family,'chart');
 assert.equal(new KnowledgeIndex([old]).search({...q,charts:[{...chart,timeframe:'15m'}]}).length,0);
 assert.equal(new KnowledgeIndex([old]).search({...q,charts:[{...chart,timeframe:'unknown'}]}).length,0);
 assert.equal(mergeCases(old,{mint:OLD,observedAt:Date.now()+1}).charts.length,1);
 const many=normalizeCase({mint:OLD,charts:Array.from({length:7},(_,i)=>({...chart,capturedAt:i+1}))});assert.equal(many.charts.filter(c=>c.preview).length,2);
});
test('cross-chain source makers and direct creator funding are useful clues without proving identity',()=>{
 const wallet='0xa4ebe558b6f9554a4f2a1c315e4e72fd67725517',src=chain=>({chain,address:wallet,source:'https://stats-api.dln.trade/api/Orders/public-order'});
 let index=new KnowledgeIndex([{mint:OLD,creator:CREATOR,sourceWallets:[src('1')]}]);
 let hit=index.search({mint:CA,sourceWallets:[src('4663')],funding:[{address:CREATOR,signature:'known-transfer'}]})[0];assert(hit.evidence.some(e=>e.family==='source_funding'));assert(hit.evidence.some(e=>e.family==='creator_funding'));assert.equal(hit.identityEstablished,false);
 assert.equal(index.search({mint:CA,sourceWallets:[{...src('4663'),service:true}]}).length,0);
});
test('a structured reply cannot write another CA, fabricate chart captures or leak previews into prompts',()=>{
 const block=p=>'Answer\n```devlens-memory\n'+JSON.stringify(p)+'\n```';assert.equal(splitMemoryReply(block({mint:OLD,creator:CREATOR}),CA).profile,null);
 const good=splitMemoryReply(block({mint:CA,creator:CREATOR,charts:[chart],twitter:'https://x.com/one'}),CA);assert.equal(good.text,'Answer');assert.equal(good.profile.charts.length,0);
 const p=normalizeCase({mint:CA,charts:[chart],notes:'private note not for prompt'}),lib={index:new KnowledgeIndex([p])},context=promptMemory(lib,p,[]);assert(!context.includes('base64'));assert(!context.includes('private note'));
});
test('unavailable metadata never becomes invented profile data',async()=>{
 assert.equal(await enrichMetadata(CA,async()=>({ok:false})),null);
 assert.equal(await enrichMetadata(CA,async()=>({ok:true,json:async()=>({mint:OLD,creator:CREATOR})})),null);
});
