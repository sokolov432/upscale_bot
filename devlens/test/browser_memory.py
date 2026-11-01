"""Persistent memory UI and real extension quick preview, with public RPC fixtures."""
import json, pathlib, tempfile, time, struct, zlib
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
SITE='https://sokolov432.github.io/upscale_bot/'
MINT='DwdiS94nXvBzQJSYNSRjdAUMK9BJ7sxeXMXfQxVM95Vg'
SH='9MhyrmteMknv7tvNixSj7kiHyYA2hNSiB1TfPc2Nrsxj'
FIXTURE=json.loads((ROOT/'test/fixtures/glass-quick.json').read_text())

def serve(route):
    url=route.request.url
    if url.startswith(SITE):
        name=url[len(SITE):].split('?',1)[0] or 'index.html';file=(ROOT/'web'/name).resolve()
        if not file.is_relative_to((ROOT/'web').resolve()) or not file.is_file():route.fulfill(status=404,body='Not found');return
        kind={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}.get(file.suffix,'application/octet-stream')
        route.fulfill(status=200,body=file.read_bytes(),content_type=kind);return
    if url.startswith('chrome-extension://'):route.continue_();return
    route.abort()

with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='devlens-memory-') as profile:
    appearance_file=pathlib.Path(profile)/'appearance.png'
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    pixels=b''.join(b'\x00'+b''.join(bytes((x*27,y*31,(x+y)*13)) for x in range(9)) for y in range(8))
    appearance_file.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',9,8,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b''))
    extension=str(ROOT/'dist/extension')
    context=p.chromium.launch_persistent_context(profile,headless=True,channel='chromium',args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'],viewport=dict(width=1440,height=1000))
    context.route('**/*',serve);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(SITE,wait_until='networkidle');page.wait_for_function("() => document.querySelector('#memory-count').textContent==='8'")
    page.wait_for_function("() => document.querySelector('#transport').textContent.includes('1.3.0')")
    worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
    worker.evaluate("""f=>{globalThis.memoryCalls=[];globalThis.fetch=async(url,options={})=>{
      const body=options.body?JSON.parse(options.body):{};if(String(url).startsWith('https://api.openai.com/')){globalThis.aiPromptContainsKey=options.body.includes('fixture-only-openai-key');const packet=JSON.parse(body.input[0].content[0].text),answer={summary:'Совпала группа первых покупателей. Общий владелец не установлен.',candidates:[{mint:packet.candidates[0].mint,reason:'Совпадают ранние покупки',evidenceIds:[packet.facts[0].id]}],limitations:['Не установлен общий владелец'],nextChecks:['Проверить независимые пополнения']};return new Response(JSON.stringify({output_text:JSON.stringify(answer)}),{status:200});}memoryCalls.push({url:String(url),method:body.method});let result;
      if(String(url).includes('pump.fun'))return new Response(JSON.stringify(f.coin),{status:200});
      if(body.method==='getSignaturesForAddress')result=f.creatorHistory;
      else if(body.method==='getTransaction')result=f.transactions[body.params[0]];
      else if(body.method==='getBlock')result=f.block;
      else throw Error('Unexpected fixture RPC method');
      return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}),{status:200});
    };}""",FIXTURE)
    # A known CA produces a real saved finding without a single source request.
    page.locator('#ca').fill(MINT);started=time.monotonic();page.locator('#submit').click()
    page.wait_for_selector('#memory-result:not(.hidden)');cached_ms=(time.monotonic()-started)*1000
    assert cached_ms<2000,cached_ms
    assert 'stonkholder' in page.locator('#memory-matches').inner_text()
    assert 'Связь подтверждена вами' in page.locator('#memory-matches').inner_text()
    assert worker.evaluate('memoryCalls.length')==0
    assert not page.locator('#progress').is_visible()
    page.locator('.memory-edit-details').first.locator('summary').click()
    page.locator('#memory-group').fill('Проверенная группа')
    page.locator('#memory-notes').fill('Моя заметка после проверки')
    page.locator('#memory-edit button[type=submit]').click()
    page.wait_for_function("() => document.querySelector('#memory-status').textContent.includes('Заметки сохранены')")
    page.reload(wait_until='networkidle');page.wait_for_selector('#memory-result:not(.hidden)')
    assert page.locator('#memory-group').input_value()=='Проверенная группа'
    assert page.locator('#memory-notes').input_value()=='Моя заметка после проверки'
    # Reject survives a forced seed refresh; it is not overwritten by examples.
    page.locator('.memory-reject').first.click()
    page.wait_for_function("() => !document.querySelector('#memory-matches').textContent.includes('stonkholder')")
    page.evaluate("""async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('devlens-memory');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});await new Promise((res,rej)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put({id:'seed-version',value:0});tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();}""")
    page.reload(wait_until='networkidle');page.wait_for_selector('#memory-result:not(.hidden)')
    assert 'stonkholder' not in page.locator('#memory-matches').inner_text()
    assert page.locator('#memory-notes').input_value()=='Моя заметка после проверки'
    page.locator('.memory-edit-details').first.locator('summary').click()
    page.locator('[data-link-reset]').click()
    page.wait_for_function("() => document.querySelector('#memory-matches').textContent.includes('stonkholder')")
    # Manual social snapshots carry a source and timestamp; missing counts are unknown.
    page.locator('.memory-edit-details').nth(1).locator('summary').click()
    assert 'Автоматического доступа' in page.locator('#social-snapshots').inner_text()
    page.locator('#social-url').fill('https://x.com/tryglasspad')
    page.locator('#social-name').fill('Glasspad profile snapshot')
    page.locator('#social-followers').fill('1234')
    page.locator('#social-bio').fill('An independent open source community project building tools for token research and public data')
    page.locator('#social-appearance').set_input_files(str(appearance_file))
    page.locator('#social-save').click()
    page.wait_for_function("() => document.querySelector('#memory-status').textContent.includes('Снимок профиля сохранён')")
    assert '1\u00a0234' in page.locator('#social-snapshots').inner_text()
    assert 'отпечаток' in page.locator('#social-snapshots').inner_text()
    # AI is optional, does not block matching, and cannot access a key on the site.
    page.locator('#memory-ai').click()
    page.wait_for_function("() => document.querySelector('#memory-ai-status').textContent.includes('OpenAI API')")
    worker.evaluate("""async()=>{await chrome.storage.local.set({aiApiKey:'fixture-only-openai-key',aiModel:'fixture-model'});const original=chrome.permissions.contains;chrome.permissions.contains=options=>options.origins?.includes('https://api.openai.com/*')?Promise.resolve(true):original(options);}""")
    page.locator('#memory-ai').click()
    page.wait_for_selector('#memory-ai-result .ai-summary',timeout=10000)
    assert 'Общий владелец не установлен' in page.locator('#memory-ai-result').inner_text()
    assert not worker.evaluate('aiPromptContainsKey')
    assert 'fixture-only-openai-key' not in page.locator('body').inner_text()
    assert 'связь запусков подтверждена' not in page.locator('#memory-decisions').inner_text()
    # Export is a backup of evidence fingerprints, annotations and decisions.
    with page.expect_download() as info:page.locator('#memory-export').click()
    backup_file=pathlib.Path(profile)/'backup.json';info.value.save_as(backup_file)
    backup=json.loads(backup_file.read_text());saved=next(c for c in backup['cases'] if c['mint']==MINT)
    assert saved['notes']=='Моя заметка после проверки'
    assert saved['analyses'][-1]['model']=='fixture-model'
    assert 'fixture-only-openai-key' not in backup_file.read_text()
    assert saved['socials'][-1]['followers']==1234 and len(saved['socials'][-1]['appearanceHash'])==16
    invalid=pathlib.Path(profile)/'invalid.json';invalid.write_text(json.dumps({'version':1,'cases':[{'mint':'bad'}],'links':[]}))
    page.locator('#memory-import').set_input_files(str(invalid))
    page.wait_for_function("() => document.querySelector('#memory-status').textContent.includes('Импорт не выполнен')")
    assert page.locator('#memory-count').inner_text()=='8'
    # Delete only the known GLASS case and its decision so the next lookup must
    # derive the SH relationship from replayed transactions, not a preloaded link.
    page.evaluate("""async mint=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('devlens-memory');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});await new Promise((res,rej)=>{const tx=db.transaction(['cases','links'],'readwrite');tx.objectStore('cases').delete(mint);const request=tx.objectStore('links').getAll();request.onsuccess=()=>{for(const l of request.result)if(l.a===mint || l.b===mint)tx.objectStore('links').delete(l.id);};tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();}""",MINT)
    page.goto(SITE,wait_until='networkidle');page.wait_for_function("() => document.querySelector('#memory-count').textContent==='7'")
    page.locator('#ca').fill(MINT);started=time.monotonic();page.locator('#submit').click()
    page.wait_for_selector('#memory-result:not(.hidden)',timeout=15000);fresh_ms=(time.monotonic()-started)*1000
    assert 'stonkholder' in page.locator('#memory-matches').inner_text()
    assert 'Сильный кандидат' in page.locator('#memory-matches').inner_text()
    assert '6 общих ранних покупателей' in page.locator('#memory-matches').inner_text()
    assert worker.evaluate("memoryCalls.some(c=>c.method==='getBlock')")
    assert page.locator('#memory-count').inner_text()=='8'
    page.reload(wait_until='networkidle');page.locator('#ca').fill(MINT);page.locator('#submit').click();page.wait_for_selector('#memory-result:not(.hidden)')
    assert 'stonkholder' in page.locator('#memory-matches').inner_text()
    page.locator('#memory-import').set_input_files(str(backup_file))
    page.wait_for_function("() => document.querySelector('#memory-status').textContent.includes('Импортировано')")
    assert page.locator('#memory-notes').input_value()=='Моя заметка после проверки'
    page.evaluate("window.scrollTo(0,document.querySelector('#memory-result').offsetTop-60)")
    page.screenshot(path=str(ROOT/'research/memory-desktop.png'))
    page.set_viewport_size(dict(width=390,height=844));assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.screenshot(path=str(ROOT/'research/memory-mobile.png'))
    # Browser storage failure is explicit; a preview remains exportable, never
    # presented as a successful persistent save.
    blocked=context.new_page();blocked.on('pageerror',lambda e:errors.append(str(e)))
    blocked.add_init_script("Object.defineProperty(window,'indexedDB',{value:{open(){throw Error('Storage denied')}}})")
    blocked.goto(SITE,wait_until='networkidle')
    blocked.wait_for_function("() => document.querySelector('#memory-status').textContent.includes('не сохранены')")
    blocked.locator('#ca').fill(MINT);blocked.locator('#submit').click()
    blocked.wait_for_selector('#memory-result:not(.hidden)',timeout=15000)
    assert 'не сохранена' in blocked.locator('#memory-coverage').inner_text()
    with blocked.expect_download() as info:blocked.locator('#memory-export').click()
    unsaved_file=pathlib.Path(profile)/'unsaved-backup.json';info.value.save_as(unsaved_file)
    assert any(c['mint']==MINT for c in json.loads(unsaved_file.read_text())['cases'])
    blocked.close()
    assert not errors,errors
    report=dict(passed=True,cached_lookup_ms=round(cached_ms,1),fresh_fixture_lookup_ms=round(fresh_ms,1),zero_network_cached_lookup=True,persistence=True,seed_preserves_user_decision=True,social_snapshots=True,backup_roundtrip=True,invalid_import_atomic=True,automatic_cohort_match=True,optional_ai_summary=True,ai_key_not_exposed=True,storage_failure_reported=True,mobile_overflow=False,page_errors=errors,evidence='Extension network replay uses public mainnet fixtures. Live-provider timings are recorded separately.')
    (ROOT/'research/browser-memory.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));context.close()
