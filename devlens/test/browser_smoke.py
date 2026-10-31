"""Run against a built site with Playwright's full Chromium (not headless shell).

The website + MV3 extension + offscreen analysis worker round-trip uses explicit
network fixtures. Real example on-chain evidence is tested separately by CLI.
No fixture report is published as real blockchain evidence.
"""
import base64, json, pathlib, tempfile
from playwright.sync_api import sync_playwright

ROOT=pathlib.Path(__file__).resolve().parents[1]
SITE='https://sokolov432.github.io/upscale_bot/'
MINT='57YQJbgdE32ZMCQzBivhjcXmnMLY5iw2MwrtcPYWpump'
DEV='HhJvJTnRRtcQVpiWMi9RVCNuTiAgCEdDroPZtWLTao2t'
FUNDER='HhrUtbuwYowNH5AzsMVojGogziQQDwWFS24EdCvYhuwt'
COIN=dict(mint=MINT,creator=DEV,name='Browser fixture',symbol='TEST',created_timestamp=101000,complete=True)
seen=[]
def un58(value):
    n=0
    for c in value:n=n*58+'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.index(c)
    return b'\0'*(len(value)-len(value.lstrip('1')))+n.to_bytes((n.bit_length()+7)//8,'big')
curve_account=json.loads((ROOT/'test/fixtures/pump-accounts.json').read_text())['curveAccount']
curve_bytes=bytearray(base64.b64decode(curve_account['data'][0]));curve_bytes[49:81]=un58(DEV)
curve_account={**curve_account,'data':[base64.b64encode(curve_bytes).decode(),'base64']}
creation_event=json.loads((ROOT/'test/fixtures/create-event.json').read_text())
FIXTURE_ARGS=dict(coin=COIN,dev=DEV,funder=FUNDER,curveAccount=curve_account,creationEvent=creation_event)
FIXTURE="""({coin,dev,funder,curveAccount,creationEvent})=>{
  globalThis.fixtureCalls=[];globalThis.fixtureMode='fallback';
  globalThis.fetch=async(url,options={})=>{
    url=String(url);const b=options.body?JSON.parse(options.body):{};
    fixtureCalls.push({url,method:b.method});let data;
    if(url.includes('pump.fun')){
      if(fixtureMode==='pump-blocked')return new Response('Forbidden',{status:403});
      data=url.includes('user-created-coins')?{coins:url.includes(dev)?[coin]:[]}:coin;
    }
    else {
      if(fixtureMode==='blocked' || (fixtureMode==='fallback' && url.includes('publicnode.com')))return new Response('Forbidden',{status:403});
      let result;
      if(b.method==='getGenesisHash')result='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
      else if(b.method==='getAccountInfo')result={value:b.params[0]===coin.mint?{data:{parsed:{info:{extensions:[{extension:'tokenMetadata',state:{name:coin.name,symbol:coin.symbol,uri:'https://example.invalid/metadata'}}]}}}}:curveAccount};
      else if(b.method==='getSignaturesForAddress')result=[dev,'6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'].includes(b.params[0])?[{signature:'browser-fixture-transfer',slot:1,blockTime:100,err:null}]:[];
      else if(b.method==='getTransaction')result={blockTime:100,meta:{err:null,preTokenBalances:[],postTokenBalances:[],innerInstructions:fixtureMode==='pump-blocked'?[{instructions:creationEvent.eventInstructions}]:[],logMessages:fixtureMode==='pump-blocked'?['Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',creationEvent.eventLog,'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success']:[]},transaction:{message:{accountKeys:[{pubkey:funder,signer:true},{pubkey:dev,signer:false}],instructions:[{programId:'11111111111111111111111111111111',parsed:{type:'transfer',info:{source:funder,destination:dev,lamports:1000000000}}}]}}};
      else throw Error('Unexpected fixture method '+b.method);
      data={jsonrpc:'2.0',id:1,result};
    }
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  };
}"""

def serve(route):
    request=route.request;url=request.url
    if url.startswith(SITE):
        name=url.split(SITE,1)[1].split('?',1)[0] or 'index.html'
        file=(ROOT/'web'/name).resolve()
        if not file.is_relative_to((ROOT/'web').resolve()) or not file.is_file():
            route.fulfill(status=404,body='Not found');return
        kind={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml'}.get(file.suffix,'application/octet-stream')
        route.fulfill(status=200,body=file.read_bytes(),content_type=kind);return
    if url.startswith('chrome-extension://'):
        route.continue_();return
    seen.append(dict(url=url,origin=request.headers.get('origin')))
    if 'frontend-api-v3.pump.fun' in url:
        data=dict(coins=[COIN] if DEV in url else []) if 'user-created-coins' in url else COIN
    elif 'api.mainnet-beta.solana.com' in url:
        body=request.post_data_json;method=body['method'];address=body['params'][0]
        if method=='getSignaturesForAddress':
            value=[dict(signature='browser-fixture-transfer',slot=1,blockTime=100,err=None)] if address==DEV else []
        elif method=='getTransaction':
            value=dict(blockTime=100,meta=dict(err=None,preTokenBalances=[],postTokenBalances=[],innerInstructions=[],logMessages=[]),transaction=dict(message=dict(accountKeys=[dict(pubkey=FUNDER,signer=True),dict(pubkey=DEV,signer=False)],instructions=[dict(programId='11111111111111111111111111111111',parsed=dict(type='transfer',info=dict(source=FUNDER,destination=DEV,lamports=1000000000)))])))
        else: raise AssertionError(method)
        data=dict(jsonrpc='2.0',id=1,result=value)
    else:
        route.abort();return
    route.fulfill(status=200,content_type='application/json',body=json.dumps(data),headers={'Access-Control-Allow-Origin':'*'})

with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='devlens-browser-') as profile:
    extension=str(ROOT/'dist/extension')
    context=p.chromium.launch_persistent_context(profile,headless=True,channel='chromium',args=[f'--disable-extensions-except={extension}',f'--load-extension={extension}'],viewport=dict(width=1440,height=1000))
    context.route('**/*',serve)
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(SITE,wait_until='networkidle')
    page.wait_for_function("() => document.querySelector('#transport').textContent.includes('Расширение подключено')")
    worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
    worker.evaluate(FIXTURE,FIXTURE_ARGS)
    page.locator('#ca').fill(MINT);page.locator('#submit').click()
    try:page.wait_for_selector('#results:not(.hidden)',timeout=30000)
    except Exception:
        print('DEBUG',page.locator('#error').inner_text(),page.locator('#progress').inner_text(),'REQUESTS',seen,'WORKERS',[w.url for w in context.service_workers]);raise
    assert page.locator('#token-rows tr').count()==1
    assert 'Browser fixture' in page.locator('#token-title').inner_text()
    assert 'Тот же creator' in page.locator('#token-rows').inner_text()
    assert '1 SOL' in page.locator('#evidence-rows').inner_text()
    assert len(page.locator('svg .graph-node').all())==2
    stats=page.locator('#stats .stat-value').all_text_contents()
    assert stats==['1','0','1','1'], stats  # Two graph nodes, only one decoded wallet.
    coverage=page.locator('#coverage-text').text_content()
    assert 'PublicNode: blocked' in coverage, coverage
    assert 'Solana public RPC: healthy' in coverage, coverage
    worker=context.service_workers[0]
    assert worker.evaluate('chrome.offscreen.hasDocument()')
    with page.expect_download() as info:page.locator('#export-csv').click()
    assert info.value.suggested_filename=='devlens-tokens.csv'
    page.locator('#token-filter').fill('not-present');assert 'По этому фильтру' in page.locator('#token-rows').inner_text()
    page.locator('#token-filter').fill('')
    page.set_viewport_size(dict(width=390,height=844))
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    page.wait_for_function("() => document.querySelector('#graph').scrollLeft>0")
    page.set_viewport_size(dict(width=1440,height=1000))
    # Settings are opened by the real extension, not a simulated webpage form.
    with context.expect_page() as info:page.locator('#rpc-settings-top').click()
    settings=info.value;settings.on('pageerror',lambda e:errors.append(str(e)));settings.wait_for_selector('#rpc')
    assert settings.locator('#rpc').get_attribute('type')=='password'
    settings.locator('#rpc').fill('https://solana-rpc.publicnode.com/')
    settings.locator('button[type=submit]').click()
    settings.wait_for_function("() => document.querySelector('#status').textContent.includes('Сохранено')")
    assert worker.evaluate("async()=> (await chrome.storage.local.get('customRpcURL')).customRpcURL")=='https://solana-rpc.publicnode.com/'
    settings.evaluate(FIXTURE,FIXTURE_ARGS)
    settings.evaluate("fixtureMode='healthy'")
    settings.locator('#test').click()
    settings.wait_for_function("() => document.querySelector('#status').textContent.includes('история и транзакции доступны')",timeout=15000)
    settings.locator('#reset').click()
    settings.wait_for_function("() => document.querySelector('#status').textContent.includes('удалён')")
    assert worker.evaluate("async()=> (await chrome.storage.local.get('customRpcURL')).customRpcURL") is None
    settings.close()
    # Pump.fun can fail independently of RPC. Recover through verified program
    # state and CreateEvent rather than another endpoint on the blocked service.
    worker.evaluate("fixtureMode='pump-blocked'")
    page.locator('#submit').click();page.wait_for_selector('#results:not(.hidden)',timeout=20000)
    assert 'Browser fixture' in page.locator('#token-title').inner_text()
    assert 'Реестр Pump.fun недоступен' in page.locator('#partial-warning').inner_text()
    assert 'Pump.fun on-chain account' in page.locator('#coverage-text').text_content()
    assert 'CreateEvent' in page.locator('#evidence-rows').inner_text()
    assert 'Нет данных' in page.locator('#token-rows').inner_text()
    # A blocked history must hide the previous report and display a real error.
    worker.evaluate("fixtureMode='blocked'")
    page.locator('#submit').click();page.wait_for_selector('#error:not(.hidden)',timeout=20000)
    assert 'не выполнен' in page.locator('#error').inner_text()
    assert not page.locator('#results').is_visible()
    assert page.locator('#rpc-actions').is_visible()
    # The deployed page refuses 1.1, which cannot recover when the Pump.fun registry fails.
    before=worker.evaluate('fixtureCalls.length')
    page.evaluate("window.postMessage({source:'devlens-extension',type:'ready',version:'1.1.0'},location.origin)")
    page.wait_for_function("() => document.querySelector('#transport').textContent.includes('устарело')")
    page.locator('#submit').click();page.wait_for_selector('#install-dialog[open]')
    assert '1.2.0' in page.locator('#error').inner_text()
    assert worker.evaluate('fixtureCalls.length')==before
    page.locator('#close-dialog').click()
    page.evaluate("window.postMessage({source:'devlens-extension',type:'ready',version:'1.2.0'},location.origin)")
    page.wait_for_function("() => document.querySelector('#transport').textContent.includes('подключено')")
    worker.evaluate("fixtureMode='healthy'")
    # A second request can be cancelled and does not strand the UI as busy.
    page.locator('#submit').click();page.wait_for_selector('#progress:not(.hidden)');page.locator('#cancel').click();assert 'остановлена' in page.locator('#error').inner_text()
    # A separately obtained real archive is displayable without another RPC run.
    page.locator('[data-example="DZrVCDqSyUBFoFJWJCVELhzL4cTFYWpCMirnv91TTTSH"]').click()
    page.wait_for_function("() => document.querySelector('#token-title').textContent.includes('Chudbob')")
    assert page.locator('#snapshot-badge').inner_text()=='АРХИВ'
    assert page.locator('#comparison').input_value()==''
    assert page.locator('#token-rows tr').count()==99
    assert page.locator('#stats .stat-value').all_text_contents()==['7','98','197','3']
    top=page.locator('#token-rows tr').all()[:3]
    assert top[1].locator('a[aria-label="Токен в Solscan"]').get_attribute('href').endswith('8SNWRuJDaN5VFgAghb8emniYgRB5RbiVUpK4wyhedgM8')
    assert top[2].locator('a[aria-label="Токен в Solscan"]').get_attribute('href').endswith('Bvh8xqP2nkzZBBEywAFqNAc7Mek7QiUofeTmTbKRpump')
    page.evaluate("window.scrollTo(0,document.querySelector('#results').offsetTop-75)")
    page.screenshot(path=str(ROOT/'research/chudbob-v11-desktop.png'))
    page.set_viewport_size(dict(width=390,height=844))
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    page.screenshot(path=str(ROOT/'research/chudbob-v11-mobile.png'))
    page.locator('[data-example="FBDGFBmU2Bm9yuUAANWdPjPWFwhGnidbeesJPKyPpump"]').click()
    page.wait_for_function("() => document.querySelector('#token-title').textContent.includes('BREACH')")
    assert page.locator('#stats .stat-value').all_text_contents()==['2','0','13','1']
    assert 'Creator в аккаунте программы' in page.locator('#evidence-rows').inner_text()
    assert page.locator('#snapshot-badge').inner_text()=='АРХИВ'
    page.set_viewport_size(dict(width=1440,height=1000))
    page.evaluate("window.scrollTo(0,document.querySelector('#results').offsetTop-75)")
    page.screenshot(path=str(ROOT/'research/breach-v12-desktop.png'))
    assert not errors, errors
    report=dict(passed=True,extension_bridge=True,offscreen_worker=True,analysis_roundtrip=True,primary_403_fallback=True,pump_403_onchain_recovery=True,all_rpc_blocked_error=True,old_extension_version_gate=True,settings_save_health_reset=True,csv_export=True,mobile_overflow=False,cancellation=True,real_archive_render=True,page_errors=errors,fixture_requests=worker.evaluate('fixtureCalls.length'),evidence='Live round-trip uses network fixtures; CHUDBOB render uses the separately obtained real archive')
    (ROOT/'research/browser-smoke.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
    context.close()
