import {addressFromInput} from './engine.mjs';
const $=s=>document.querySelector(s),send=m=>chrome.runtime.sendMessage({target:'devlens-chat-relay',...m});
let selectedId=null,polling=false;
function renderJob(job){
  if(!job)return;$('#answer').hidden=false;$('#answer-title').textContent=job.name || 'Запрос в ChatGPT';$('#answer-ca').textContent=job.ca;$('#answer-text').textContent=job.text || '';
  $('#answer-status').textContent=job.status==='done'?(job.cached?'Из кэша · ':'Готово · ')+new Date(job.updatedAt).toLocaleString():job.status==='error'?job.error:'CA отправлен. Чат анализирует токен…';
  if(job.matches?.length)$('#answer-text').textContent+='\n\nСовпадения в памяти (гипотезы):\n'+job.matches.map(m=>(m.name || m.mint)+' · '+m.mint+'\n'+m.evidence.map(e=>e.label).join('; ')).join('\n');
  if(job.memoryError)$('#answer-text').textContent+='\n\n'+job.memoryError;
}
async function refresh(){
  if(polling)return;polling=true;
  try{const r=await send({type:'status'});if(!r.ok)throw Error(r.error);$('#binding').textContent=r.binding?'Этот чат: '+r.binding.title:'Этот разговор будет найден автоматически при запросе.';
    const jobs=r.jobs || [],job=jobs.find(j=>j.id===selectedId) || jobs.at(-1);renderJob(job);
    const history=$('#history');history.replaceChildren();
    for(const j of [...jobs].reverse()){const b=document.createElement('button');b.className='quiet';b.textContent=(j.name || j.ca.slice(0,10)+'…')+' · '+new Date(j.createdAt).toLocaleDateString()+' · '+({done:'ответ',error:'ошибка',running:'анализ',dispatching:'отправка'}[j.status] || j.status);b.onclick=()=>{selectedId=j.id;renderJob(j);};history.append(b);}
  }catch(e){$('#error').textContent=e.message;}finally{polling=false;}
}
async function action(m){$('#error').textContent='';try{const r=await send(m);if(!r.ok)throw Error(r.error);if(r.job){selectedId=r.job.id;renderJob(r.job);}await refresh();}catch(e){$('#error').textContent=e.message;}}
$('#chat').onclick=()=>action({type:'open-chat'});
$('#analyze').onclick=()=>{try{action({type:'analyze-ca',ca:addressFromInput($('#ca').value)});}catch(e){$('#error').textContent=e.message;}};
$('#fresh').onclick=()=>{try{action({type:'analyze-ca',ca:addressFromInput($('#ca').value),force:true});}catch(e){$('#error').textContent=e.message;}};
$('#memory-export').onclick=async()=>{try{const r=await send({type:'memory-export'});if(!r.ok)throw Error(r.error);const url=URL.createObjectURL(new Blob([JSON.stringify(r.backup,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='devlens-observations.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('#error').textContent=e.message;}};
$('#open').onclick=()=>{try{const input=$('#ca').value.trim(),suffix=input?'?ca='+encodeURIComponent(addressFromInput(input)):'';chrome.tabs.create({url:'https://sokolov432.github.io/upscale_bot/'+suffix});}catch(e){$('#error').textContent=e.message;}};
$('#settings').onclick=()=>chrome.runtime.openOptionsPage();
chrome.storage.onChanged.addListener((c,area)=>{if(area==='local' && c.chatRelay)refresh();});
await refresh();setInterval(refresh,2500);
