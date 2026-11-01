import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationURL,investigationPrompt,resolveAxiomToken,CHAT_TIMEOUT_MS} from '../chat-protocol.mjs';
import {installChatRelay} from '../chat-controller.mjs';
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
function harness(){
  let listener,removed,state={},sent=[];
  const tabs=new Map([[8,{id:8,url:CHAT,title:'Our investigation',windowId:1}]]);
  const api={runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onMessage:{addListener:f=>listener=f}},storage:{local:{get:async k=>({[k]:structuredClone(state[k])}),set:async o=>Object.assign(state,structuredClone(o))}},tabs:{get:async id=>{if(!tabs.has(id))throw Error('Missing tab');return tabs.get(id);},query:async()=>[...tabs.values()],sendMessage:async(id,m)=>{if(m.type==='probe')return {ready:true};sent.push(m);return {accepted:true};},update:async()=>{},onRemoved:{addListener:f=>removed=f}},windows:{update:async()=>{}}};
  installChatRelay(api);
  const popup={id:api.runtime.id,url:api.runtime.getURL('popup.html')},axiom={id:api.runtime.id,url:'https://axiom.trade/meme/'+POOL,tab:{id:3}},chat={id:api.runtime.id,url:CHAT,tab:{id:8}};
  const send=(m,s=popup)=>new Promise(resolve=>listener({target:'devlens-chat-relay',...m},s,resolve));
  return {api,popup,axiom,chat,send,sent,tabs,get state(){return state;},removed:()=>removed(8)};
}
test('relay requires binding, serializes clicks, rejects forged answers and keeps completed replies',async()=>{
  const h=harness();assert.equal((await h.send({type:'analyze-ca',ca:CA})).ok,false);
  assert.equal((await h.send({type:'bind'})).ok,true);
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
  installChatRelay(h.api);assert.equal((await h.send({type:'result',id:r.job.id,text:'After worker restart'},h.chat)).ok,true);
  r=await h.send({type:'analyze-ca',ca:OTHER});h.state.chatRelay.jobs.at(-1).createdAt-=CHAT_TIMEOUT_MS+1;
  assert.equal((await h.send({type:'status'})).jobs.at(-1).status,'error');
  await h.send({type:'analyze-ca',ca:CA});await h.removed();assert.equal((await h.send({type:'status'})).jobs.at(-1).status,'error');assert.equal(h.sent.length,3);
});
