"""Real MV3 round trip on explicit Axiom/ChatGPT page fixtures, no real prompts."""
import json, pathlib, tempfile
from playwright.sync_api import sync_playwright

ROOT=pathlib.Path(__file__).resolve().parents[1]
CA='7Ad8WyDQRgUwYFg4bWTp4jxhuXaJEKEDtrXU8peoqqXw'
OTHER='BPGA2Yg7sqNkWXzUnsWGpVjCkD6sSVBQDyvgDQJepump'
POOL='5KWBrjA5Vkw9snAWaecFsvvJ1E3iZWzUAB12vzNDmCF'
CHAT='https://chatgpt.com/c/devlens-browser-test'
ANSWER='Кандидат: QUANTCOIN\n7JhZyNNcGconCnhssAVAzvzyVU5aUqDNcDZnazScpump\nОбщий исходный maker; владелец не доказан. <img src=x onerror=alert(1)>'
chat_html='''<!doctype html><meta charset="utf-8"><title>Selected investigation</title><main id="turns"></main><div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">Send</button><script>
window.sent=[];window.complete=false;
document.querySelector('button').onclick=()=>{
 const input=document.querySelector('#prompt-textarea'),prompt=input.innerText;window.sent.push(prompt);input.textContent='';
 const user=document.createElement('article');user.innerHTML='<div data-message-author-role="user" data-message-id="u'+sent.length+'"></div>';user.firstChild.textContent=prompt;document.querySelector('#turns').append(user);
 const stop=document.createElement('button');stop.dataset.testid='stop-button';stop.id='stop';document.body.append(stop);
 const reply=document.createElement('article');reply.id='reply'+sent.length;const message=document.createElement('div');message.dataset.messageAuthorRole='assistant';message.innerHTML='<div class="markdown">Проверяю цепочку…</div>';reply.append(message);document.querySelector('#turns').append(reply);
};
window.finish=(text)=>{document.querySelector('#stop')?.remove();const article=document.querySelector('#turns article:last-child');article.querySelector('.markdown').textContent=text;const copy=document.createElement('button');copy.dataset.testid='copy-turn-action-button';article.append(copy);window.complete=true;};
</script>'''
axiom_html=f'''<!doctype html><meta charset="utf-8"><title>Waink · Axiom</title><style>body{{background:#10141a;color:#eee;font:16px system-ui;padding:40px}}h1{{display:inline}}header{{display:flex;align-items:center;gap:10px}}</style><header data-testid="token-header"><h1 data-testid="token-name">Waink</h1><a href="https://solscan.io/token/{CA}">Contract</a></header>'''
requests=[]
def route(r):
    url=r.request.url
    if url.startswith('chrome-extension://'):r.continue_();return
    if url.startswith('https://chatgpt.com/'):
        r.fulfill(content_type='text/html',body=chat_html);return
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
    # Bind through the real popup handler while the intended chat is active.
    chat.bring_to_front()
    popup.evaluate("document.querySelector('#bind').click()")
    try:popup.wait_for_function("() => document.querySelector('#binding').textContent.includes('Выбран:')",polling=200,timeout=10000)
    except Exception:
        print('BIND ERROR',popup.locator('#error').inner_text(),worker.evaluate('chrome.tabs.query({active:true,currentWindow:true})'),errors,flush=True);raise
    axiom.bring_to_front()
    # A script on the trading page cannot trigger automatic chat messages.
    axiom.evaluate("document.querySelector('[data-devlens-magnifier]').click()")
    assert chat.evaluate('sent.length')==0
    axiom.locator('[data-devlens-magnifier]').click()
    chat.wait_for_function('() => sent.length===1')
    assert CA in chat.evaluate('sent[0]') and POOL not in chat.evaluate('sent[0]')
    axiom.locator('[data-devlens-magnifier]').click();assert chat.evaluate('sent.length')==1
    # A tool pause without final turn controls must not be treated as the answer.
    chat.evaluate("document.querySelector('#stop').remove()")
    axiom.wait_for_timeout(2600)
    assert worker.evaluate("async()=> (await chrome.storage.local.get('chatRelay')).chatRelay.jobs.at(-1).status")=='running'
    chat.evaluate('text=>finish(text)',ANSWER)
    axiom.wait_for_function("() => document.querySelector('#devlens-axiom-panel').shadowRoot.querySelector('pre').textContent.includes('QUANTCOIN')")
    assert not axiom.locator('#devlens-axiom-panel').locator('img').count()
    popup.wait_for_function("() => document.querySelector('#answer-text').textContent.includes('QUANTCOIN')")
    # Unsent draft remains untouched; rejection is displayed to the user.
    chat.locator('#prompt-textarea').fill('Мой неотправленный текст')
    axiom.locator('[data-devlens-magnifier]').click()
    axiom.wait_for_function("() => document.querySelector('#devlens-axiom-panel').shadowRoot.querySelector('[role=status]').textContent.includes('неотправленный')")
    assert chat.locator('#prompt-textarea').inner_text()=='Мой неотправленный текст'
    assert chat.evaluate('sent.length')==1
    chat.locator('#prompt-textarea').fill('')
    # In-page token navigation and missing CA link use the pool resolver.
    axiom.evaluate("() => {history.pushState({},'',location.pathname+'?next=1');const name=document.createElement('div');name.className='font-medium text-[20px]';name.textContent='Hash Punk';document.querySelector('h1').replaceWith(name);document.querySelector('header a').remove();}")
    axiom.locator('[data-devlens-magnifier]').click()
    chat.wait_for_function('() => sent.length===2')
    assert OTHER in chat.evaluate('sent[1]') and POOL not in chat.evaluate('sent[1]')
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
    chat.close();popup.locator('#ca').fill(CA);popup.locator('#analyze').click()
    popup.wait_for_function("() => document.querySelector('#error').textContent.includes('закреплённый чат')")
    assert not errors,errors
    report=dict(passed=True,real_mv3=True,fixture_pages=True,real_user_chat_tested=False,bind_popup=True,ca_not_pool=True,pool_resolution=True,round_trip=True,final_only=True,no_duplicate=True,draft_preserved=True,untrusted_click_ignored=True,reply_plain_text=True,popup_history=True,closed_chat_error=True,page_errors=errors)
    (ROOT/'research/browser-chat.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
    context.close()
