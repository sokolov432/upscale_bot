(() => {
  if(!['axiom.trade','www.axiom.trade'].includes(location.hostname))return;
  if(globalThis.__devlensAxiomPageV15)return;globalThis.__devlensAxiomPageV15=true;
  const address=s=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');
  const send=m=>chrome.runtime.sendMessage({target:'devlens-chat-relay',...m});
  const active=s=>['dispatching','running'].includes(s);
  let anchor,button,panel,host,output,heading,status,selectedCA=null,lastURL=location.href,routeChangedAt=0;
  let refreshing=false,refreshTimer;
  function tokenContext(){
    // Explicit token links/attributes in the token heading outrank the URL's
    // pool address. Do not scan arbitrary page text or the user's holdings.
    const visible=n=>n.getBoundingClientRect().top>=0 && n.getBoundingClientRect().top<380 && n.getBoundingClientRect().width>0;
    const heads=[...document.querySelectorAll('h1, h2')].filter(visible);
    const links=[...document.querySelectorAll('a[href*="solscan.io/token/"], a[href*="pump.fun/coin/"]')].filter(n=>n.getBoundingClientRect().top>=0 && n.getBoundingClientRect().top<380 && !n.closest('table, [role="row"], aside'));
    let name=[...document.querySelectorAll('[data-testid="token-name"], [data-testid="token-header"] h1')].find(visible),region;
    // Axiom also renders the token name as a styled div. Walk up from its
    // explorer link rather than selecting unrelated navigation/holdings text.
    if(!name)for(const link of links){
      let parent=link.parentElement;
      for(let depth=0;parent && depth<4;depth++,parent=parent.parentElement){
        const options=[...parent.querySelectorAll('h1, h2, [class*="font-semibold"], [class*="font-medium"]')].filter(n=>visible(n) && !n.contains(link) && !n.closest('button, table, [role="row"]') && (n.innerText || '').trim().length>0 && (n.innerText || '').trim().length<80 && !/^(contract|copy|solscan|pump\.fun)$/i.test((n.innerText || '').trim()));
        if(options.length){name=options.find(n=>/text-\[(?:18|20|24)px\]/.test(n.className)) || options.find(n=>n.matches('h1,h2')) || options[0];region=parent;break;}
      }
      if(name)break;
    }
    name ||= heads[0] || [...document.querySelectorAll('[class*="text-[20px]"][class*="font-medium"], [class*="text-[24px]"][class*="font-medium"], [data-testid="token-header"] [class*="font-medium"]')].find(visible);
    if(!name)return null;
    region ||= name.closest('[data-testid="token-header"]') || name.parentElement?.parentElement;
    const near=links.find(n=>region?.contains(n));let mintHint=null;
    if(near){try{const u=new URL(near.href);mintHint=u.pathname.match(/\/(?:token|coin)\/([1-9A-HJ-NP-Za-km-z]{32,44})(?:\/|$)/)?.[1] || null;}catch{}}
    const attr=name.getAttribute('data-token-address') || region?.getAttribute('data-token-address');
    if(!mintHint && address(attr))mintHint=attr;
    return {anchor:name,nameHint:(name.innerText || name.textContent || '').trim().slice(0,100),mintHint};
  }
  function makePanel(){
    if(panel)return;
    host=document.createElement('div');host.id='devlens-axiom-panel';document.documentElement.append(host);const shadow=host.attachShadow({mode:'open'});
    const style=document.createElement('style');style.textContent=`:host{all:initial;color-scheme:dark}*{box-sizing:border-box}section{position:fixed;right:16px;top:72px;width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 96px);overflow:auto;z-index:2147483647;background:#10161f;color:#e5edf6;border:1px solid #38504b;border-radius:16px;box-shadow:0 20px 80px #0009;font:14px/1.6 system-ui;padding:20px}header{display:flex;justify-content:space-between;gap:10px}h2{font-size:18px;margin:0}p{color:#a7b8cb;margin:10px 0}button{cursor:pointer;border:1px solid #3c5145;border-radius:8px;background:#1b2922;color:#b5f57a;padding:7px 10px;font:inherit}nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.65 system-ui;margin:16px 0}code{font-size:11px;overflow-wrap:anywhere;color:#b3f67c}section[hidden]{display:none}.error{color:#ffb5a1}`;
    panel=document.createElement('section');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','DevLens — предыдущие запуски');
    const header=document.createElement('header');heading=document.createElement('h2');heading.textContent='DevLens';const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Закрыть');close.onclick=()=>panel.hidden=true;header.append(heading,close);
    status=document.createElement('p');status.setAttribute('role','status');output=document.createElement('pre');const nav=document.createElement('nav'),chat=document.createElement('button'),refresh=document.createElement('button');chat.textContent='Открыть этот чат';chat.onclick=async()=>{const r=await send({type:'open-chat'});if(!r.ok)showError(r.error);};refresh.textContent='Проверить заново';refresh.dataset.devlensRefresh='true';refresh.onclick=e=>{if(e.isTrusted)inspect(true);};nav.append(chat,refresh);panel.append(header,status,output,nav);shadow.append(style,panel);
  }
  function showError(text){makePanel();panel.hidden=false;status.textContent=text;status.className='error';}
  function render(job){
    makePanel();status.className='';heading.textContent=job.name || 'DevLens · предыдущие запуски';
    if(active(job.status)){status.textContent='CA отправлен в выбранный чат. Идёт анализ…';output.textContent=job.ca;}
    else if(job.status==='done'){status.textContent=(job.cached?'Сохранённый ответ':'Ответ из этого чата')+' · '+new Date(job.updatedAt).toLocaleTimeString();output.textContent=job.text;}
    else{status.textContent=job.error || 'Не удалось получить ответ.';status.className='error';output.textContent=job.ca;}
    if(job.matches?.length)output.textContent+='\n\nСовпадения в памяти (не доказательство владельца):\n'+job.matches.map(m=>(m.name || m.mint)+' · '+m.mint+'\n'+m.evidence.map(e=>e.label).join('; ')).join('\n\n');
    if(job.memoryError)output.textContent+='\n\n'+job.memoryError;
  }
  async function inspect(force=false){
    // A click can arrive before the debounced SPA observer. Record the new
    // route now so decorate() cannot hide the newly opened result panel.
    const navigated=location.href!==lastURL;if(navigated){lastURL=location.href;selectedCA=null;routeChangedAt=Date.now();}
    makePanel();panel.hidden=false;status.className='';status.textContent='Определяю CA токена…';output.textContent='';
    const context=tokenContext();
    if(!context){showError('Заголовок токена не найден. Вставьте CA в окно расширения.');return;}
    const capture=Date.now()-routeChangedAt<1500?{chart:null}:globalThis.DevLensChartCapture?.snapshot() || {chart:null};
    const region=context.anchor.closest('[data-testid="token-header"]') || context.anchor.parentElement?.parentElement;
    const x=[...(region?.querySelectorAll('a[href]') || [])].map(a=>a.href).find(h=>/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[a-zA-Z0-9_]{1,15}\/?$/.test(h));
    try{const r=await send({type:'analyze-page',mintHint:navigated?null:context.mintHint,nameHint:context.nameHint,observation:{chart:capture.chart,twitter:x},force});if(!r.ok)throw Error(r.error);selectedCA=r.job.ca;render(r.job);}catch(e){showError(e.message || 'Расширение обновилось. Перезагрузите Axiom.');}
  }
  function decorate(){
    if(location.href!==lastURL){lastURL=location.href;selectedCA=null;routeChangedAt=Date.now();if(panel)panel.hidden=true;}
    if(!/^\/meme\//.test(location.pathname)){button?.remove();button=null;anchor=null;return;}
    for(const legacy of document.querySelectorAll('[data-devlens-magnifier]'))if(legacy!==button)legacy.remove();
    const c=tokenContext();if(!c)return;
    if(anchor===c.anchor && button?.isConnected)return;
    button?.remove();anchor=c.anchor;button=document.createElement('button');button.type='button';button.dataset.devlensMagnifier='true';button.title='Найти предыдущий токен дева через ChatGPT';button.setAttribute('aria-label','DevLens: найти предыдущий токен дева');
    button.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin-left:6px;padding:5px;vertical-align:middle;border:1px solid #3c5145;border-radius:7px;background:#17221c;color:#b5f57a;cursor:pointer;flex-shrink:0;';
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','18');svg.setAttribute('height','18');svg.setAttribute('aria-hidden','true');for(const [tag,attrs]of [['circle',{cx:10,cy:10,r:6}],['path',{d:'m15 15 5 5'}]]){const n=document.createElementNS(svg.namespaceURI,tag);for(const[k,v]of Object.entries({...attrs,fill:'none',stroke:'currentColor','stroke-width':2}))n.setAttribute(k,v);svg.append(n);}button.append(svg);button.onclick=e=>{if(!e.isTrusted)return;e.preventDefault();e.stopPropagation();inspect();};anchor.insertAdjacentElement('afterend',button);
  }
  const schedule=()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(decorate,200);};
  new MutationObserver(records=>{if(records.some(r=>r.target!==host && !host?.contains(r.target)))schedule();}).observe(document.documentElement,{childList:true,subtree:true});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local' || !changes.chatRelay || !selectedCA)return;const j=changes.chatRelay.newValue?.jobs?.filter(j=>j.ca===selectedCA).at(-1);if(j)render(j);});
  // Polling also re-establishes the MV3 worker after suspension and notices SPA
  // navigation performed via history.pushState without replacing the heading.
  setInterval(async()=>{decorate();if(!selectedCA || refreshing)return;refreshing=true;try{const r=await send({type:'status'}),j=r.jobs?.filter(j=>j.ca===selectedCA).at(-1);if(j)render(j);}catch{}finally{refreshing=false;}},2500);
  decorate();
})();
