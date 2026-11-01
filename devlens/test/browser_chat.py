"""Real MV3 round trip on explicit Axiom/ChatGPT page fixtures, no real prompts."""
import json, pathlib, tempfile
from playwright.sync_api import sync_playwright

ROOT=pathlib.Path(__file__).resolve().parents[1]
CA='7Ad8WyDQRgUwYFg4bWTp4jxhuXaJEKEDtrXU8peoqqXw'
OTHER='BPGA2Yg7sqNkWXzUnsWGpVjCkD6sSVBQDyvgDQJepump'
POOL='5KWBrjA5Vkw9snAWaecFsvvJ1E3iZWzUAB12vzNDmCF'
CHAT='https://chatgpt.com/c/devlens-browser-test'
MARKER='devlens-context-0b676816-bdc9-4902-9398-691b0313c619'
ANSWER='Кандидат: QUANTCOIN\n7JhZyNNcGconCnhssAVAzvzyVU5aUqDNcDZnazScpump\nОбщий исходный maker; владелец не доказан. <img src=x onerror=alert(1)>'
chat_html=r'''<!doctype html><meta charset="utf-8"><title>Selected investigation</title><main id="turns"><article><div data-message-author-role="assistant"><a href="https://sokolov432.github.io/upscale_bot/devlens-extension.zip?context=devlens-context-0b676816-bdc9-4902-9398-691b0313c619">Обновление</a></div></article></main><div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">Send</button><script>
window.sent=[];window.complete=false;
document.querySelector('button').onclick=()=>{
 const input=document.querySelector('#prompt-textarea'),prompt=input.innerText;window.sent.push(prompt);input.textContent='';
 const user=document.createElement('article');user.innerHTML='<div data-message-author-role="user" data-message-id="u'+sent.length+'"></div>';user.firstChild.textContent=prompt;document.querySelector('#turns').append(user);
 const stop=document.createElement('button');stop.dataset.testid='stop-button';stop.id='stop';document.body.append(stop);
 const reply=document.createElement('article');reply.id='reply'+sent.length;const message=document.createElement('div');message.dataset.messageAuthorRole='assistant';message.innerHTML='<div class="markdown">Проверяю цепочку…</div>';reply.append(message);document.querySelector('#turns').append(reply);
};
window.finish=(text)=>{document.querySelector('#stop')?.remove();const article=document.querySelector('#turns article:last-child');const body=article.querySelector('.markdown'),block=text.match(/```devlens-memory\s*([\s\S]*?)```/);body.textContent=block?text.replace(block[0],'').trim():text;if(block){const pre=document.createElement('pre'),code=document.createElement('code');code.className='language-devlens-memory';code.textContent=block[1];pre.append(code);body.append(pre);}const copy=document.createElement('button');copy.dataset.testid='copy-turn-action-button';article.append(copy);window.complete=true;};
</script>'''
axiom_html=f'''<!doctype html><meta charset="utf-8"><title>Waink · Axiom</title><style>body{{background:#10141a;color:#eee;font:16px system-ui;padding:40px}}h1{{display:inline}}header{{display:flex;align-items:center;gap:10px}}</style><header data-testid="token-header"><h1 data-testid="token-name">Waink</h1><a href="https://solscan.io/token/{CA}">Contract</a><a href="https://x.com/tokenprofile">X</a></header><button aria-pressed="true">5m</button><canvas id="chart" width="600" height="320" style="width:600px;height:320px"></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.fillStyle="#10141a";c.fillRect(0,0,600,320);for(let i=0;i<30;i++){{c.fillStyle=i%3?"#20c997":"#fc5a6b";c.fillRect(15+i*18,220-i*4,8,20+i%4*7);}}</script>'''
requests=[]
def route(r):
    url=r.request.url
    if url.startswith('chrome-extension://'):r.continue_();return
    if url.startswith('https://chatgpt.com/'):
        r.fulfill(content_type='text/html',body=chat_html.replace(MARKER,'unrelated') if 'unrelated' in url else chat_html);return
    if url.startswith('https://frontend-api-v3.pump.fun/'):
        mint=url.rsplit('/',1)[-1];r.fulfill(content_type='application/json',body=json.dumps(dict(mint=mint,name='Waink' if mint==CA else 'Hash Punk',creator='F4JPCzxqFPPnZynRAJrN3AQa84DANLi16xUjxgkPrLR3',twitter='https://x.com/tokenprofile')));return
    if url.startswith('https://x.com/'):
        r.fulfill(content_type='text/html',body='<main><div data-testid=primaryColumn><div data-testid=UserName>Token Profile</div><div data-testid=UserDescription>A remembered project bio with real observed fields</div><a href=/tokenprofile/verified_followers><span title=1,234>1.2K</span> Followers</a></div></main>');return
    if url.startswith('https://axiom.trade/'):
        r.fulfill(content_type='text/html',body=axiom_html);return
    if url.startswith('https://api.dexscreener.com/'):
        requests.append(url);r.fulfill(content_type='application/json',body=json.dumps(dict(pairs=[dict(chainId='solana',pairAddress=POOL,baseToken=dict(address=OTHER,name='Hash Punk'))])));return
    r.abort()

with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='devlens-chat-') as profile:
    extension=str(ROOT/'dist/extension')
    context=p.chromium.launch_persistent_context(profile,headless=True,channel='chromium',args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'],viewport=dict(width=1360,height=900))
    context.route('**/*',route)
    errors=[]
    chat=context.new_page();chat.on('pageerror',lambda e:errors.append(str(e)));chat.goto(CHAT)
    axiom=context.new_page();axiom.on('pageerror',lambda e:errors.append(str(e)));axiom.goto('https://axiom.trade/meme/'+POOL)
    axiom.wait_for_selector('[data-devlens-magnifier]')
    worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
    ext_origin=worker.url.rsplit('/',1)[0]
    popup=context.new_page();popup.goto(ext_origin+'/popup.html');popup.on('pageerror',lambda e:errors.append(str(e)))
    # No binding button: a non-matching active chat must not be selected.
    other_chat=context.new_page();other_chat.goto('https://chatgpt.com/c/unrelated')
    popup.evaluate("async mint=>{const {BrowserMemory}=await import(chrome.runtime.getURL('browser-memory.mjs'));const m=await new BrowserMemory().open();await m.save({mint,name:'Known fixture',twitter:'https://x.com/tokenprofile'});m.db.close();}",OTHER)
    axiom.bring_to_front()
    # A script on the trading page cannot trigger automatic chat messages.
    axiom.evaluate("document.querySelector('[data-devlens-magnifier]').click()")
    assert chat.evaluate('sent.length')==0
    axiom.locator('[data-devlens-magnifier]').click()
    chat.wait_for_function('() => sent.length===1')
    popup.wait_for_function("() => document.querySelector('#binding').textContent.includes('Этот чат:')")
    assert other_chat.evaluate('sent.length')==0
    assert 'Совпадает профиль X' in chat.evaluate('sent[0]')
    assert CA in chat.evaluate('sent[0].split("\\n")[0]') and POOL not in chat.evaluate('sent[0].split("\\n")[0]')
    axiom.locator('[data-devlens-magnifier]').click();assert chat.evaluate('sent.length')==1
    # A tool pause without final turn controls must not be treated as the answer.
    chat.evaluate("document.querySelector('#stop').remove()")
    axiom.wait_for_timeout(2600)
    assert worker.evaluate("async()=> (await chrome.storage.local.get('chatRelay')).chatRelay.jobs.at(-1).status")=='running'
    structured={'mint':CA,'funding':[{'address':'H95LimAz4QrZDimxDi4GbQykX8t3NTcpHJhrnA338vrQ','amount':0.55,'asset':'SOL','signature':'fixture-evidence','source':'https://solscan.io/tx/fixture-evidence'}]}
    chat.evaluate('text=>finish(text)',ANSWER+'\n```devlens-memory\n'+json.dumps(structured)+'\n```')
    axiom.wait_for_function("() => document.querySelector('#devlens-axiom-panel').shadowRoot.querySelector('pre').textContent.includes('QUANTCOIN')")
    assert not axiom.locator('#devlens-axiom-panel').locator('img').count()
    popup.wait_for_function("() => document.querySelector('#answer-text').textContent.includes('QUANTCOIN')")
    # Saved reply is instant on repeat; full history persists outside last 20 jobs.
    import time
    cached_at=time.perf_counter();axiom.locator('[data-devlens-magnifier]').click()
    axiom.wait_for_function("() => document.querySelector('#devlens-axiom-panel').shadowRoot.querySelector('[role=status]').textContent.includes('Сохранённый')")
    cached_ms=(time.perf_counter()-cached_at)*1000;assert cached_ms<2000,cached_ms;assert chat.evaluate('sent.length')==1
    def saved_case(mint):
        return popup.evaluate("async mint=>{const {BrowserMemory}=await import(chrome.runtime.getURL('browser-memory.mjs'));const m=await new BrowserMemory().open();const c=await m.get('cases',mint);m.db.close();return c;}",mint)
    stored=saved_case(CA);assert stored['charts'] and stored['charts'][-1]['preview'];assert stored['charts'][-1]['timeframe']=='5m'
    assert stored['funding'][0]['signature']=='fixture-evidence'
    assert 'devlens-memory' not in popup.locator('#answer-text').inner_text()
    social=context.new_page();social.goto('https://x.com/tokenprofile')
    for _ in range(20):
        if saved_case(CA)['socials']:break
        social.wait_for_timeout(250)
    assert saved_case(CA)['socials'][-1]['followers']==1234
    # Unsent draft remains untouched; rejection is displayed on explicit refresh.

    chat.locator('#prompt-textarea').fill('Мой неотправленный текст')
    axiom.locator('#devlens-axiom-panel').get_by_text('Проверить заново',exact=True).click()
    axiom.wait_for_function("() => document.querySelector('#devlens-axiom-panel').shadowRoot.querySelector('[role=status]').textContent.includes('неотправленный')")
    assert chat.locator('#prompt-textarea').inner_text()=='Мой неотправленный текст'
    assert chat.evaluate('sent.length')==1
    chat.locator('#prompt-textarea').fill('')
    # In-page token navigation and missing CA link use the pool resolver.
    axiom.evaluate("() => {history.pushState({},'',location.pathname+'?next=1');const name=document.createElement('div');name.className='font-medium text-[20px]';name.textContent='Hash Punk';document.querySelector('h1').replaceWith(name);document.querySelector('header a').remove();}")
    axiom.locator('[data-devlens-magnifier]').click()
    chat.wait_for_function('() => sent.length===2')
    assert OTHER in chat.evaluate('sent[1].split("\\n")[0]') and POOL not in chat.evaluate('sent[1].split("\\n")[0]')
    assert len(requests)==1
    chat.evaluate("finish('Второй завершённый ответ')")
    popup.wait_for_function("() => document.querySelector('#answer-text').textContent.includes('Второй завершённый')")
    axiom.wait_for_function("() => {const p=document.querySelector('#devlens-axiom-panel').shadowRoot.querySelector('section');return !p.hidden && p.querySelector('pre').textContent.includes('Второй завершённый');}")
    axiom.screenshot(path=str(ROOT/'research/axiom-chat-extension.png'))
    # Existing history is still available after closing and reopening the popup.
    popup.close();popup=context.new_page();popup.goto(ext_origin+'/popup.html')
    popup.wait_for_function("() => document.querySelector('#answer-text').textContent.includes('Второй завершённый')")
    assert popup.locator('#history button').count()==3
    # No destination is silently substituted after target chat closure.
    chat.close();popup.locator('#ca').fill(CA);popup.locator('#fresh').click()
    popup.wait_for_function("() => document.querySelector('#error').textContent.includes('закреплённый чат')")
    assert not errors,errors
    report=dict(passed=True,real_mv3=True,fixture_pages=True,real_user_chat_tested=False,automatic_chat=True,cached_repeat_ms=round(cached_ms,1),chart_saved=True,funding_saved=True,social_saved=True,ca_not_pool=True,pool_resolution=True,round_trip=True,final_only=True,no_duplicate=True,draft_preserved=True,untrusted_click_ignored=True,reply_plain_text=True,popup_history=True,closed_chat_error=True,page_errors=errors)
    (ROOT/'research/browser-chat.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
    context.close()
