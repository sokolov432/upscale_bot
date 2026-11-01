(() => {
  const canonical=()=>location.origin+location.pathname.replace(/\/$/,'');
  const users=()=>[...document.querySelectorAll('[data-message-author-role="user"]')];
  const assistants=()=>[...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const composer=()=>document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-testid="prompt-textarea"]');
  const sendButton=()=>document.querySelector('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Отправить запрос"]');
  const generating=()=>!!document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Остановить генерацию"], .result-streaming');
  const report=m=>chrome.runtime.sendMessage({target:'devlens-chat-relay',...m}).catch(()=>{});
  const seen=new Set();let current=null;
  const normalize=s=>String(s || '').replace(/\s+/g,' ').trim();
  function finish(error,text){
    if(!current)return;const {id,timer}=current;clearInterval(timer);current=null;
    report(error?{type:'failed',id,error}:{type:'result',id,text});
  }
  function tick(){
    if(!current)return;
    if(canonical()!==current.chatURL){finish('Открыт другой чат. Ответ не будет взят из чужого разговора.');return;}
    if(Date.now()-current.started>20*60*1000){finish('Чат не завершил ответ за 20 минут. Проверьте вкладку.');return;}
    const u=users().find(n=>!current.baseline.has(n) && !current.baselineIds.has(n.getAttribute('data-message-id')) && normalize(n.innerText || n.textContent)===normalize(current.prompt));
    if(!u){if(Date.now()-current.started>30000)finish('Отправка не подтверждена в чате. Проверьте, появился ли запрос, прежде чем повторять.');return;}
    const candidates=assistants().filter(n=>u.compareDocumentPosition(n)&Node.DOCUMENT_POSITION_FOLLOWING),last=candidates.at(-1);
    if(!last || generating())return;
    const turn=last.closest('article, [data-testid^="conversation-turn-"]') || last;
    // ChatGPT's completed turn actions distinguish final replies from pauses
    // between tool calls. Never return an intermediate investigation update.
    if(!turn.querySelector('[data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"], [data-testid="bad-response-turn-action-button"]'))return;
    const nextUser=users().find(n=>u.compareDocumentPosition(n)&Node.DOCUMENT_POSITION_FOLLOWING);
    if(nextUser && nextUser.compareDocumentPosition(last)&Node.DOCUMENT_POSITION_FOLLOWING){finish('После запроса появилось другое сообщение. Откройте чат и проверьте ответ.');return;}
    const body=last.querySelector('.markdown') || last,text=(body.innerText || body.textContent || '').trim();
    if(!text)return;
    if(current.lastText!==text){current.lastText=text;current.stableAt=Date.now();return;}
    if(Date.now()-current.stableAt>=1800)finish(null,text.slice(0,60000));
  }
  chrome.runtime.onMessage.addListener((m,sender,respond)=>{
    if(m?.target!=='devlens-chat-page' || sender.id!==chrome.runtime.id)return;
    if(m.type==='probe'){respond({ready:true});return;}
    if(m.type!=='run')return;
    if(typeof m.id!=='string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m.ca || '') || typeof m.prompt!=='string' || m.prompt.length>6000 || !m.prompt.includes(m.ca) || m.chatURL!==canonical()){
      respond({accepted:false,error:'Неверный запрос или выбрана другая вкладка чата.'});return;
    }
    if(current || seen.has(m.id) || generating()){respond({accepted:false,error:'Чат сейчас отвечает. Дождитесь завершения.'});return;}
    const input=composer();
    if(!input || input.matches(':disabled') || input.getAttribute('contenteditable')==='false'){respond({accepted:false,error:'Поле ввода ChatGPT недоступно. Проверьте вход в аккаунт.'});return;}
    const before=input.value ?? input.innerText ?? input.textContent;
    if(normalize(before)){respond({accepted:false,error:'В чате есть неотправленный текст. Отправьте или уберите его; расширение его не перезаписывает.'});return;}
    seen.add(m.id);
    current={id:m.id,prompt:m.prompt,chatURL:m.chatURL,started:Date.now(),baseline:new Set(users()),baselineIds:new Set(users().map(n=>n.getAttribute('data-message-id')).filter(Boolean)),timer:null};
    try{
      input.focus();
      if(input.tagName==='TEXTAREA'){
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,m.prompt);
        input.dispatchEvent(new Event('input',{bubbles:true}));
      }else{
        const selection=getSelection(),range=document.createRange();range.selectNodeContents(input);selection.removeAllRanges();selection.addRange(range);
        if(!document.execCommand('insertText',false,m.prompt))throw Error('Не удалось заполнить поле ChatGPT.');
        input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:m.prompt}));
      }
      let attempts=0;
      const send=()=>{
        if(!current)return;
        if(canonical()!==m.chatURL){finish('Чат переключён до отправки.');return;}
        const button=sendButton();
        if(!button || button.disabled){if(++attempts<20){setTimeout(send,150);return;}finish('Кнопка отправки недоступна. Запрос оставлен в поле ввода.');return;}
        if(normalize(input.value ?? input.innerText ?? input.textContent)!==normalize(m.prompt)){finish('Текст в поле изменился до отправки. Запрос не отправлен.');return;}
        button.click();
        current.timer=setInterval(tick,600);
      };
      setTimeout(send,150);respond({accepted:true});
    }catch(e){finish(e.message);respond({accepted:false,error:e.message});}
  });
  window.addEventListener('pagehide',()=>finish('Вкладка чата обновлена или закрыта. Проверьте ответ в чате перед повторной отправкой.'));
})();
