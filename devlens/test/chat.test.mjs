import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationURL,investigationPrompt,resolveAxiomToken,CHAT_TIMEOUT_MS} from '../chat-protocol.mjs';
import {installChatRelay} from '../chat-controller.mjs';
import {KnowledgeIndex,mergeCases,normalizeCase} from '../knowledge.mjs';
const CA='7Ad8WyDQRgUwYFg4bWTp4jxhuXaJEKEDtrXU8peoqqXw',OTHER='BPGA2Yg7sqNkWXzUnsWGpVjCkD6sSVBQDyvgDQJepump',POOL='5KWBrjA5Vkw9snAWaecFsvvJ1E3iZWzUAB12vzNDmCF';
const CHAT='https://chatgpt.com/c/test-conversation';
test('bind only an existing ChatGPT conversation, including project conversations',()=>{
  assert.equal(conversationURL(CHAT+'?model=gpt'),CHAT);
  assert.equal(conversationURL('https://chatgpt.com/g/g-p-project/c/test-chat'),'https://chatgpt.com/g/g-p-project/c/test-chat');
  for(const u of ['https://chatgpt.com/','https://chatgpt.com.evil.test/c/chat','https://evil.test/c/chat','http://chatgpt.com/c/chat'])assert.equal(conversationURL(u),null);
  assert.match(investigationPrompt(CA),/deBridge/);assert.match(investigationPrompt(CA),/Не учитывай привязанные/);assert.throws(()=>investigationPrompt('invalid'));
});
test('Axiom pool is resolved to the mint; wrong chain, unmatched pool and missing index cannot become a CA',async()=>{
  let calls=0;const request=async()=>{calls++;return {ok:true,json:async()=>({pairs:[{chainId:'solana',pairAddress:POOL,baseToken:{address:CA,name:'Waink'}}]})};};
  assert.equal((await resolveAxiomToken({pageURL:'https://axiom.trade/meme/'+POOL},request)).ca,CA);
  assert.equal((await resolveAxiomToken({pageURL:'https://axiom.trade/meme/'+POOL,mintHint:OTHER},request)).ca,OTHER);assert.equal(calls,1);
  await assert.rejects(resolveAxiomToken({pageURL:'https://evil.test/meme/'+POOL},request));
  for(const pair of [{chainId:'base',pairAddress:POOL,baseToken:{address:CA}},{chainId:'solana',pairAddress:OTHER,baseToken:{address:CA}},null])await assert.rejects(resolveAxiomToken({pageURL:'https://axiom.trade/meme/'+POOL},async()=>({ok:true,json:async()=>({pairs:pair?[pair]:[]})})));
});
function harness(marked=true){
  let listener,removed,state={},sent=[];
  const tabs=new Map([[8,{id:8,url:CHAT,title:'Our investigation',windowId:1,contextMatch:marked}]]);
  const reports=new Map(),memory={index:new KnowledgeIndex(),async save(c,{report}={}){c=mergeCases(this.index.cases.get(c.mint),c);this.index.upsert(c);if(report)reports.set(c.mint,{report});return c;},search(c){return this.index.search(c);},async get(store,id){return reports.get(id);},export(){return {version:1,cases:[...this.index.cases.values()],links:[]};}};
  const options={memoryFactory:async()=>memory,metadata:async()=>null};
  const api={runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onMessage:{addListener:f=>listener=f}},storage:{local:{get:async k=>({[k]:structuredClone(state[k])}),set:async o=>Object.assign(state,structuredClone(o))}},tabs:{get:async id=>{if(!tabs.has(id))throw Error('Missing tab');return tabs.get(id);},query:async()=>[...tabs.values()],sendMessage:async(id,m)=>{if(m.type==='probe')return {ready:true,contextMatch:tabs.get(id)?.contextMatch};sent.push(m);return {accepted:true};},update:async()=>{},onRemoved:{addListener:f=>removed=f}},windows:{update:async()=>{}}};
  installChatRelay(api,options);
  const popup={id:api.runtime.id,url:api.runtime.getURL('popup.html')},axiom={id:api.runtime.id,url:'https://axiom.trade/meme/'+POOL,tab:{id:3}},chat={id:api.runtime.id,url:CHAT,tab:{id:8}};
  const send=(m,s=popup)=>new Promise(resolve=>listener({target:'devlens-chat-relay',...m},s,resolve));
  return {api,options,memory,popup,axiom,chat,send,sent,tabs,get state(){return state;},removed:()=>removed(8)};
}
test('relay automatically finds this marked chat, serializes clicks and rejects forged answers',async()=>{
  const h=harness(false);assert.equal((await h.send({type:'analyze-ca',ca:CA})).ok,false);
  h.tabs.get(8).contextMatch=true;h.tabs.set(9,{id:9,url:'https://chatgpt.com/c/unrelated',active:true,windowId:1,contextMatch:false});
  const results=await Promise.all([h.send({type:'analyze-ca',ca:CA}),h.send({type:'analyze-ca',ca:CA})]);
  assert.equal(results[0].job.id,results[1].job.id);assert.equal(h.sent.length,1);
  const id=results[0].job.id;
  assert.equal((await h.send({type:'analyze-ca',ca:OTHER})).ok,false);
  assert.equal((await h.send({type:'result',id,text:'forged'},h.axiom)).ok,false);
  assert.equal((await h.send({type:'result',id,text:'wrong chat'},{...h.chat,url:'https://chatgpt.com/c/other-chat'})).ok,false);
  assert.equal((await h.send({type:'result',id,text:'Candidate with evidence'},h.chat)).ok,true);
  let status=await h.send({type:'status'});assert.equal(status.jobs[0].status,'done');assert.equal(status.jobs[0].text,'Candidate with evidence');
  assert.equal((await h.send({type:'result',id,text:'overwritten'},h.chat)).ok,false);
  assert.equal((await h.send({type:'status'},{id:h.api.runtime.id,url:'https://evil.test',tab:{id:4}})).ok,false);
});
test('stored job survives controller restart, expires, and a closed target chat fails without retry',async()=>{
  const h=harness();await h.send({type:'bind'});let r=await h.send({type:'analyze-ca',ca:CA});
  installChatRelay(h.api,h.options);assert.equal((await h.send({type:'result',id:r.job.id,text:'After worker restart'},h.chat)).ok,true);
  r=await h.send({type:'analyze-ca',ca:OTHER});h.state.chatRelay.jobs.at(-1).createdAt-=CHAT_TIMEOUT_MS+1;
  assert.equal((await h.send({type:'status'})).jobs.at(-1).status,'error');
  await h.send({type:'analyze-ca',ca:CA,force:true});await h.removed();assert.equal((await h.send({type:'status'})).jobs.at(-1).status,'error');assert.equal(h.sent.length,3);
});
test('cached answer avoids a second chat call; force refresh still works; catalogue outlives the job list',async()=>{
  const h=harness(),r=await h.send({type:'analyze-ca',ca:CA});await h.send({type:'result',id:r.job.id,text:'Saved answer'},h.chat);
  const cached=await h.send({type:'analyze-ca',ca:CA});assert.equal(cached.job.cached,true);assert.equal(h.sent.length,1);
  assert.equal(h.memory.index.cases.size,1);assert.equal((await h.memory.get('reports',CA)).report.chatAnswer.text,'Saved answer');
  const fresh=await h.send({type:'analyze-ca',ca:CA,force:true});assert.equal(fresh.job.status,'running');assert.equal(h.sent.length,2);
});
test('two different marked conversations are ambiguous rather than silently choosing an active chat',async()=>{
  const h=harness();h.tabs.set(9,{id:9,url:'https://chatgpt.com/c/copied-context',active:true,contextMatch:true});
  assert.equal((await h.send({type:'analyze-ca',ca:CA})).ok,false);assert.equal(h.sent.length,0);
});
test('social observations update only matching known token profiles and keep unavailable follower counts unknown',async()=>{
  const h=harness();await h.memory.save(normalizeCase({mint:CA,twitter:'https://x.com/tokenprofile'}));
  const sender={id:h.api.runtime.id,url:'https://x.com/tokenprofile',tab:{id:20}},raw={url:sender.url,bio:'Observed bio',followers:null,followersText:'1.2K',avatar:'https://pbs.twimg.com/profile_images/example.jpg'};
  assert.equal((await h.send({type:'social-observation',profile:raw},sender)).updated,1);
  assert.equal(h.memory.index.cases.get(CA).socials[0].followers,null);assert.equal(h.memory.index.cases.get(CA).socials[0].followersText,'1.2K');
  assert.equal((await h.send({type:'social-observation',profile:{...raw,url:'https://x.com/other'}},sender)).ok,false);
});
