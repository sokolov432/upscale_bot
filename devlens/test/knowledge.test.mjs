import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {normalizeCase,normalizeBackup,mergeCases,KnowledgeIndex,caseFromReport} from '../knowledge.mjs';
import {b58} from '../solana.mjs';
const seed=JSON.parse(fs.readFileSync(new URL('../web/memory-seed.json',import.meta.url))),glass=seed.cases.find(c=>c.symbol==='GLASS'),sh=seed.cases.find(c=>c.symbol==='SH'),mint=b58(Uint8Array.from({length:32},(_,i)=>i+2)),other=b58(Uint8Array.from({length:32},(_,i)=>i+3));
test('the live GLASS/SH cohort is identified without a saved manual link',()=>{
 const index=new KnowledgeIndex(seed.cases,[]),q={...glass,mint,creator:other,group:'',notes:''},hit=index.search(q).find(m=>m.mint===sh.mint);
 assert(hit);assert.equal(hit.level,'strong_candidate');assert.equal(hit.identityEstablished,false);
 const e=hit.evidence.find(e=>e.family==='early');assert.equal(e.wallets.length,6);assert.equal(e.sameOrder,6);
});
test('a saved user decision can confirm, reject, and restore a launch-group match',()=>{
 const index=new KnowledgeIndex(seed.cases,seed.links);assert.equal(index.search(glass).find(m=>m.mint===sh.mint).level,'confirmed');
 index.setLink({a:glass.mint,b:sh.mint,decision:'rejected'});assert(!index.search(glass).some(m=>m.mint===sh.mint));
 index.setLink({a:glass.mint,b:sh.mint,decision:'unreviewed'});assert.equal(index.search(glass).find(m=>m.mint===sh.mint).level,'strong_candidate');
});
test('one funding overlap and a common service never establish an owner',()=>{
 const a=normalizeCase({mint,creator:mint,funding:[{address:glass.creator,service:false}]}),b=normalizeCase({mint:other,creator:other,funding:[{address:glass.creator,service:false}]});let hit=new KnowledgeIndex([b]).search(a)[0];assert.equal(hit.level,'weak');assert.equal(hit.identityEstablished,false);
 b.funding[0].service=true;assert.equal(new KnowledgeIndex([b]).search(a).length,0);
});
test('bios, appearance and similar follower counts stay weak without stronger evidence',()=>{
 const snapshot={url:'https://x.com/exampleone',bio:'An independent open source experiment building a useful community tool for everyone today',followers:1020,appearanceHash:'ff00ff00ff00ff00',capturedAt:1234567890};
 const a=normalizeCase({mint,socials:[snapshot]}),b=normalizeCase({mint:other,socials:[{...snapshot,url:'https://x.com/exampletwo',followers:1000}]});const m=new KnowledgeIndex([b]).search(a)[0];assert.equal(m.level,'weak');assert(m.evidence.some(e=>e.family==='audience'));assert(m.evidence.some(e=>e.family==='appearance'));
});
test('missing followers remain unknown and arbitrary RPC secrets are not copied into cases',()=>{
 const c=caseFromReport({target:{mint,creator:other,website:'https://example.com/?api-key=fixture-secret'},analysedAt:new Date().toISOString(),rpcEndpoints:[{url:'https://private.invalid/?api-key=fixture-secret'}],wallets:[]});assert(!JSON.stringify(c).includes('fixture-secret'));assert.equal(normalizeCase({mint,socials:[{url:'https://x.com/test'}]}).socials[0].followers,null);
});
test('a later full report preserves early buyers and user notes from memory',()=>{
 const old={...glass,notes:'Checked by me',group:'My group'},next={...glass,early:[],coverage:{early:false,funding:false},notes:'',group:'',observedAt:glass.observedAt+1000},merged=mergeCases(old,next);
 assert.equal(merged.early.length,6);assert.equal(merged.notes,'Checked by me');assert.equal(merged.group,'My group');
});
test('a deliberately cleared note is not restored by background data or example updates',()=>{const cleared={...glass,notes:'',group:'',annotationAt:Date.now()},fresh={...glass,observedAt:glass.observedAt+10000};for(const result of [mergeCases(cleared,fresh),mergeCases(fresh,cleared)]){assert.equal(result.notes,'');assert.equal(result.group,'');}});
test('malformed backups fail validation before any writes',()=>{
 assert.throws(()=>normalizeBackup({version:1,cases:[{mint:'2'.repeat(32)}],links:[]}));assert.throws(()=>normalizeBackup({version:2,cases:[],links:[]}));
});
test('an indexed database of ten thousand cases returns candidates within two seconds',()=>{
 const cases=Array.from({length:10000},(_,i)=>{const b=new Uint8Array(32);b[0]=99;new DataView(b.buffer).setUint32(28,i);return {mint:b58(b),name:'Case '+i,website:'https://site'+i+'.example'};}),index=new KnowledgeIndex([...cases,sh]),start=performance.now(),hits=index.search({...glass,mint,creator:other});
 const elapsedMs=performance.now()-start;assert(hits.some(m=>m.mint===sh.mint));assert(elapsedMs<2000,`Indexed lookup took ${elapsedMs}ms`);
});
test('a recurring signed cohort remains useful as its launch history accumulates',()=>{
 const cases=Array.from({length:45},(_,i)=>{const b=new Uint8Array(32);b[0]=77;new DataView(b.buffer).setUint32(28,i);return {...sh,mint:b58(b)};}),q={...glass,mint,creator:other},index=new KnowledgeIndex(cases);
 assert.equal(index.search(q)[0].level,'strong_candidate');
 const noOrder={...q,early:q.early.map(e=>({...e,order:null,coSigners:[]}))};
 assert(!index.search(noOrder)[0].evidence[0].label.includes('в том же порядке'));
});
