import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {Analyzer,PUMP} from '../engine.mjs';
import {curveAddress,decodeCurve,decodeMetadata,un58,METADATA_PROGRAM} from '../solana.mjs';
import {SourceError} from '../rpc-config.js';
const accounts=JSON.parse(fs.readFileSync(new URL('./fixtures/pump-accounts.json',import.meta.url)));
const event=JSON.parse(fs.readFileSync(new URL('./fixtures/create-event.json',import.meta.url)));
test('PDA and creator decoding match an independently fetched mainnet curve',async()=>{
 assert.equal(await curveAddress(accounts.mint),accounts.curve);
 assert.equal(decodeCurve(accounts.curveAccount).creator,accounts.creator);
 assert.equal(decodeCurve({...accounts.curveAccount,owner:'11111111111111111111111111111111'}),null);
 const b=Buffer.from(accounts.curveAccount.data[0],'base64');b[0]^=1;
 assert.equal(decodeCurve({...accounts.curveAccount,data:[b.toString('base64'),'base64']}),null);
 assert.equal(decodeCurve({...accounts.curveAccount,data:[Buffer.alloc(49).toString('base64'),'base64']}),null);
});
function fallbackAnalyzer({withEvent=true}={}){
 const mint=event.expectedMint,creator=event.expectedCreator,a=new Analyzer({limits:{peerWallets:0}}),calls=[];
 const b=Buffer.from(accounts.curveAccount.data[0],'base64');b.set(un58(creator),49);
 const curve={...accounts.curveAccount,data:[b.toString('base64'),'base64']};
 a.get=async(url,body)=>{
  calls.push({url,method:body?.method});
  if(url.includes('pump.fun'))throw new SourceError('HTTP 403',{kind:'blocked',status:403});
  if(body.method==='getAccountInfo')return {result:{value:body.params[0]===mint?{data:{parsed:{info:{extensions:[{extension:'tokenMetadata',state:{name:'No Nut November',symbol:'NNN',uri:'https://example.invalid/metadata'}}]}}}}:curve}};
  if(body.method==='getSignaturesForAddress')return {result:[{signature:event.signature,slot:1,blockTime:100,err:null}]};
  if(body.method==='getTransaction')return {result:{blockTime:100,meta:{err:null,preTokenBalances:[],postTokenBalances:[],innerInstructions:withEvent?[{instructions:event.eventInstructions}]:[],logMessages:withEvent?['Program '+PUMP+' invoke [1]',event.eventLog,'Program '+PUMP+' success']:[]},transaction:{message:{accountKeys:[{pubkey:creator,signer:true},{pubkey:accounts.creator,signer:false}],instructions:[{programId:'11111111111111111111111111111111',parsed:{type:'transfer',info:{source:accounts.creator,destination:creator,lamports:1000000000}}}]}}}};
  throw Error('Unexpected fixture request');
 };
 return {a,calls,mint};
}
test('Pump 403 falls back to verified program state and discovers creations from actual event bytes',async()=>{
 const {a,calls,mint}=fallbackAnalyzer(),r=await a.run(mint);
 assert.equal(calls.filter(c=>c.url.includes('pump.fun')).length,1);
 assert.equal(r.target.creator,event.expectedCreator);assert.equal(r.target.createdAt,100000);
 assert.equal(r.target.onChain,true);assert.equal(r.target.migrated,null);
 assert.equal(r.wallets[0].creationProof.mint,mint);assert.equal(r.wallets[0].coins.length,1);
 assert.equal(r.coverage.transactionsDecoded,1);assert.equal(r.registryDiagnostics.state,'blocked');
 assert.equal(r.coverage.truncatedCreatorLists,1);
});
test('missing launch time does not label post-launch receipts as pre-launch funding',async()=>{
 const {a,mint}=fallbackAnalyzer({withEvent:false}),r=await a.run(mint);
 assert.equal(r.target.createdAt,null);assert.equal(r.wallets[0].funders.length,0);
 assert(r.wallets[0].warnings.some(w=>w.includes('Время запуска не установлено')));
});
test('a metadata-shaped account does not substitute for an authenticated Pump curve',async()=>{
 const {a,mint}=fallbackAnalyzer();a.get=async(url)=>{if(url.includes('pump.fun'))throw new SourceError('HTTP 403',{kind:'blocked',status:403});return {result:{value:{owner:'11111111111111111111111111111111',data:accounts.curveAccount.data}}};};
 await assert.rejects(()=>a.run(mint),e=>e.kind==='creator_unavailable');
 assert.equal(decodeMetadata(accounts.curveAccount,mint),null);
});
test('Metaplex metadata is bound to its mint and rejects truncated string lengths',()=>{
 const head=Buffer.alloc(65);head[0]=4;head.set(un58(accounts.mint),33);
 const str=s=>{const n=Buffer.alloc(4);n.writeUInt32LE(Buffer.byteLength(s));return Buffer.concat([n,Buffer.from(s)]);};
 const bytes=Buffer.concat([head,str('Example'),str('EX'),str('https://example.invalid/metadata')]);
 const account={owner:METADATA_PROGRAM,data:[bytes.toString('base64'),'base64']};
 assert.equal(decodeMetadata(account,accounts.mint).name,'Example');assert.equal(decodeMetadata(account,event.expectedMint),null);
 account.data=[bytes.subarray(0,bytes.length-1).toString('base64'),'base64'];assert.equal(decodeMetadata(account,accounts.mint),null);
});
