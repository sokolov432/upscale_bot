import {validAddress} from './engine.mjs';
import {CHAT_STATE_KEY,CHAT_TIMEOUT_MS,ACTIVE_CHAT_STATES,isAxiomURL,conversationURL,investigationPrompt,publicJob,cleanRelayState,resolveAxiomToken} from './chat-protocol.mjs';

export function installChatRelay(api=chrome){
  // Serialize state changes so two quick clicks cannot send two prompts.
  let serial=Promise.resolve();
  const locked=fn=>{const p=serial.then(fn);serial=p.catch(()=>{});return p;};
  const read=async()=>cleanRelayState((await api.storage.local.get(CHAT_STATE_KEY))[CHAT_STATE_KEY]);
  const write=state=>api.storage.local.set({[CHAT_STATE_KEY]:state});
  const extensionPage=sender=>sender.id===api.runtime.id && sender.url===api.runtime.getURL('popup.html');
  const sourceAllowed=sender=>extensionPage(sender) || sender.id===api.runtime.id && isAxiomURL(sender.url) && Number.isInteger(sender.tab?.id);
  async function findChat(binding){
    if(!binding)throw Error('Сначала откройте нужный чат ChatGPT и нажмите «Использовать этот чат» в расширении.');
    let tab;try{tab=await api.tabs.get(binding.tabId);}catch{}
    if(conversationURL(tab?.url)===binding.url)return tab;
    const tabs=await api.tabs.query({url:'https://chatgpt.com/*'});
    tab=tabs.find(t=>conversationURL(t.url)===binding.url);
    if(!tab)throw Error('Откройте закреплённый чат ChatGPT в этом браузере.');
    return tab;
  }
  async function status(){return locked(async()=>{
    const s=await read(),now=Date.now();let changed=false;
    for(const j of s.jobs)if(ACTIVE_CHAT_STATES.has(j.status) && now-j.createdAt>CHAT_TIMEOUT_MS){j.status='error';j.error='Ответ не получен за 20 минут. Проверьте вкладку чата. Повторная отправка — только по вашему нажатию.';j.updatedAt=now;changed=true;}
    if(changed)await write(s);
    return {binding:s.binding?{url:s.binding.url,title:s.binding.title}:null,jobs:s.jobs.map(publicJob)};
  });}
  async function bind(sender){
    if(!extensionPage(sender))throw Error('Выберите чат через окно расширения.');
    const [tab]=await api.tabs.query({active:true,currentWindow:true}),url=conversationURL(tab?.url);
    if(!url)throw Error('Откройте именно существующий разговор на chatgpt.com, затем снова нажмите эту кнопку.');
    const ready=await api.tabs.sendMessage(tab.id,{target:'devlens-chat-page',type:'probe'}).catch(()=>null);
    if(!ready?.ready)throw Error('Обновите вкладку ChatGPT после установки расширения.');
    return locked(async()=>{const s=await read();if(s.jobs.some(j=>ACTIVE_CHAT_STATES.has(j.status)))throw Error('Дождитесь текущего анализа перед сменой чата.');s.binding={tabId:tab.id,url,title:String(tab.title || 'ChatGPT').slice(0,150),boundAt:Date.now()};await write(s);return {binding:{url,title:s.binding.title}};});
  }
  async function start(m,sender){
    if(!sourceAllowed(sender))throw Error('Запрос разрешён только из Axiom или окна расширения.');
    // Resolve the pool before locking, then re-check for an existing active job.
    const token=m.type==='analyze-page'?await resolveAxiomToken({pageURL:sender.url,mintHint:m.mintHint,nameHint:m.nameHint}):{ca:m.ca,name:''};
    if(!validAddress(token.ca))throw Error('Введите полный Solana CA токена.');
    const prepared=await locked(async()=>{
      const s=await read(),busy=s.jobs.find(j=>ACTIVE_CHAT_STATES.has(j.status));
      if(busy){if(busy.ca===token.ca)return {existing:publicJob(busy)};throw Error('Другой токен уже анализируется. Дождитесь ответа.');}
      const tab=await findChat(s.binding),now=Date.now(),job={id:crypto.randomUUID(),ca:token.ca,name:token.name,status:'dispatching',createdAt:now,updatedAt:now,chatTabId:tab.id,chatURL:s.binding.url};
      s.jobs.push(job);s.jobs=s.jobs.slice(-20);await write(s);return {job};
    });
    if(prepared.existing)return {job:prepared.existing};
    const {job}=prepared;
    try{
      const reply=await api.tabs.sendMessage(job.chatTabId,{target:'devlens-chat-page',type:'run',id:job.id,ca:job.ca,chatURL:job.chatURL,prompt:investigationPrompt(job.ca)});
      if(!reply?.accepted)throw Error(reply?.error || 'Вкладка ChatGPT не готова. Обновите её и проверьте вход в аккаунт.');
      await locked(async()=>{const s=await read(),j=s.jobs.find(j=>j.id===job.id);if(j && j.status==='dispatching'){j.status='running';j.updatedAt=Date.now();await write(s);}});
    }catch(e){await locked(async()=>{const s=await read(),j=s.jobs.find(j=>j.id===job.id);if(j && ACTIVE_CHAT_STATES.has(j.status)){j.status='error';j.error=e.message || String(e);j.updatedAt=Date.now();await write(s);}});}
    const s=await read();return {job:publicJob(s.jobs.find(j=>j.id===job.id))};
  }
  async function receive(m,sender){
    if(sender.id!==api.runtime.id || !Number.isInteger(sender.tab?.id) || !conversationURL(sender.url))throw Error('Неизвестная вкладка ответа.');
    return locked(async()=>{
      const s=await read(),j=s.jobs.find(j=>j.id===m.id);
      if(!j || !ACTIVE_CHAT_STATES.has(j.status) || j.chatTabId!==sender.tab.id || j.chatURL!==conversationURL(sender.url))throw Error('Ответ не относится к текущему запросу.');
      if(m.type==='result'){
        if(typeof m.text!=='string' || !m.text.trim() || m.text.length>60000)throw Error('Некорректный ответ чата.');
        j.status='done';j.text=m.text.trim();
      }else{j.status='error';j.error=String(m.error || 'Связь с чатом прервана.').slice(0,800);}
      j.updatedAt=Date.now();await write(s);return {saved:true};
    });
  }
  api.runtime.onMessage.addListener((m,sender,respond)=>{
    if(m?.target!=='devlens-chat-relay')return;
    (async()=>{
      if(['result','failed'].includes(m.type))return receive(m,sender);
      if(!sourceAllowed(sender))throw Error('Недопустимый источник запроса.');
      if(m.type==='status')return status();
      if(m.type==='bind')return bind(sender);
      if(m.type==='analyze-page' || m.type==='analyze-ca')return start(m,sender);
      if(m.type==='open-chat'){
        const s=await read(),tab=await findChat(s.binding);await api.tabs.update(tab.id,{active:true});await api.windows.update(tab.windowId,{focused:true});return {opened:true};
      }
      if(m.type==='unbind')return locked(async()=>{const s=await read();if(s.jobs.some(j=>ACTIVE_CHAT_STATES.has(j.status)))throw Error('Дождитесь текущего анализа.');s.binding=null;await write(s);return {removed:true};});
      throw Error('Неизвестная команда.');
    })().then(value=>respond({ok:true,...value}),e=>respond({ok:false,error:e.message || String(e)}));
    return true;
  });
  api.tabs.onRemoved.addListener(tabId=>locked(async()=>{const s=await read();let changed=false;for(const j of s.jobs)if(j.chatTabId===tabId && ACTIVE_CHAT_STATES.has(j.status)){j.status='error';j.error='Вкладка чата закрыта. Запрос мог остаться в чате; проверьте его перед повтором.';j.updatedAt=Date.now();changed=true;}if(changed)await write(s);}).catch(()=>{}));
  api.tabs.onUpdated?.addListener((tabId,change)=>{
    if(!change.url)return;
    locked(async()=>{const s=await read();let changed=false;for(const j of s.jobs)if(j.chatTabId===tabId && ACTIVE_CHAT_STATES.has(j.status) && conversationURL(change.url)!==j.chatURL){j.status='error';j.error='Вкладка переключена на другой разговор. Проверьте ответ в закреплённом чате перед повтором.';j.updatedAt=Date.now();changed=true;}if(changed)await write(s);}).catch(()=>{});
  });
}
