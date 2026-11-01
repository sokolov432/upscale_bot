import {addressFromInput} from './engine.mjs';
const $=s=>document.querySelector(s),send=m=>chrome.runtime.sendMessage({target:'devlens-chat-relay',...m});
let selectedId=null,polling=false;
function renderJob(job){
  if(!job)return;$('#answer').hidden=false;$('#answer-title').textContent=job.name || 'Запрос в ChatGPT';$('#answer-ca').textContent=job.ca;$('#answer-text').textContent=job.text || '';
  $('#answer-status').textContent=job.status==='done'?'Готово · '+new Date(job.updatedAt).toLocaleString():job.status==='error'?job.error:'CA отправлен. Чат анализирует токен…';
}
async function refresh(){
  if(polling)return;polling=true;
  try{const r=await send({type:'status'});if(!r.ok)throw Error(r.error);$('#binding').textContent=r.binding?'Выбран: '+r.binding.title:'Чат ещё не выбран.';$('#chat').disabled=!r.binding;$('#unbind').disabled=!r.binding;
    const jobs=r.jobs || [],job=jobs.find(j=>j.id===selectedId) || jobs.at(-1);renderJob(job);
    const history=$('#history');history.replaceChildren();
    for(const j of [...jobs].reverse()){const b=document.createElement('button');b.className='quiet';b.textContent=(j.name || j.ca.slice(0,10)+'…')+' · '+new Date(j.createdAt).toLocaleDateString()+' · '+({done:'ответ',error:'ошибка',running:'анализ',dispatching:'отправка'}[j.status] || j.status);b.onclick=()=>{selectedId=j.id;renderJob(j);};history.append(b);}
  }catch(e){$('#error').textContent=e.message;}finally{polling=false;}
}
async function action(m){$('#error').textContent='';try{const r=await send(m);if(!r.ok)throw Error(r.error);if(r.job){selectedId=r.job.id;renderJob(r.job);}await refresh();}catch(e){$('#error').textContent=e.message;}}
$('#bind').onclick=()=>action({type:'bind'});
$('#chat').onclick=()=>action({type:'open-chat'});
$('#unbind').onclick=()=>action({type:'unbind'});
$('#analyze').onclick=()=>{try{action({type:'analyze-ca',ca:addressFromInput($('#ca').value)});}catch(e){$('#error').textContent=e.message;}};
$('#open').onclick=()=>{try{const input=$('#ca').value.trim(),suffix=input?'?ca='+encodeURIComponent(addressFromInput(input)):'';chrome.tabs.create({url:'https://sokolov432.github.io/upscale_bot/'+suffix});}catch(e){$('#error').textContent=e.message;}};
$('#settings').onclick=()=>chrome.runtime.openOptionsPage();
chrome.storage.onChanged.addListener((c,area)=>{if(area==='local' && c.chatRelay)refresh();});
await refresh();setInterval(refresh,2500);
