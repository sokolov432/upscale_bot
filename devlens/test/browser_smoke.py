"""Run against a built site with Playwright's full Chromium (not headless shell).

The website + MV3 extension + offscreen analysis worker round-trip uses explicit
network fixtures. Real example on-chain evidence is tested separately by CLI.
No fixture report is published as real blockchain evidence.
"""
import json, pathlib, tempfile
from playwright.sync_api import sync_playwright

ROOT=pathlib.Path(__file__).resolve().parents[1]
SITE='https://sokolov432.github.io/upscale_bot/'
MINT='57YQJbgdE32ZMCQzBivhjcXmnMLY5iw2MwrtcPYWpump'
DEV='HhJvJTnRRtcQVpiWMi9RVCNuTiAgCEdDroPZtWLTao2t'
FUNDER='HhrUtbuwYowNH5AzsMVojGogziQQDwWFS24EdCvYhuwt'
COIN=dict(mint=MINT,creator=DEV,name='Browser fixture',symbol='TEST',created_timestamp=101000,complete=True)
seen=[]

def serve(route):
    request=route.request;url=request.url
    if url.startswith(SITE):
        name=url.split(SITE,1)[1].split('?',1)[0] or 'index.html'
        file=(ROOT/'web'/name).resolve()
        if not file.is_relative_to((ROOT/'web').resolve()) or not file.is_file():
            route.fulfill(status=404,body='Not found');return
        kind={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml'}.get(file.suffix,'application/octet-stream')
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
    page.wait_for_function("document.querySelector('#transport').textContent.includes('Расширение подключено')")
    worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
    worker.evaluate("""({coin,dev,funder})=>{
      globalThis.fixtureCalls=[];
      globalThis.fetch=async(url,options={})=>{
        url=String(url);fixtureCalls.push(url);let data;
        if(url.includes('pump.fun'))data=url.includes('user-created-coins')?{coins:url.includes(dev)?[coin]:[]}:coin;
        else {const b=JSON.parse(options.body);let result;
          if(b.method==='getSignaturesForAddress')result=b.params[0]===dev?[{signature:'browser-fixture-transfer',slot:1,blockTime:100,err:null}]:[];
          else result={blockTime:100,meta:{err:null,preTokenBalances:[],postTokenBalances:[],innerInstructions:[],logMessages:[]},transaction:{message:{accountKeys:[{pubkey:funder,signer:true},{pubkey:dev,signer:false}],instructions:[{programId:'11111111111111111111111111111111',parsed:{type:'transfer',info:{source:funder,destination:dev,lamports:1000000000}}}]}}};
          data={jsonrpc:'2.0',id:1,result};}
        return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
      };
    }""",dict(coin=COIN,dev=DEV,funder=FUNDER))
    page.locator('#ca').fill(MINT);page.locator('#submit').click()
    try:page.wait_for_selector('#results:not(.hidden)',timeout=30000)
    except Exception:
        print('DEBUG',page.locator('#error').inner_text(),page.locator('#progress').inner_text(),'REQUESTS',seen,'WORKERS',[w.url for w in context.service_workers]);raise
    assert page.locator('#token-rows tr').count()==1
    assert 'Browser fixture' in page.locator('#token-title').inner_text()
    assert 'Тот же creator' in page.locator('#token-rows').inner_text()
    assert '1 SOL' in page.locator('#evidence-rows').inner_text()
    assert len(page.locator('svg .graph-node').all())==2
    worker=context.service_workers[0]
    assert worker.evaluate('chrome.offscreen.hasDocument()')
    with page.expect_download() as info:page.locator('#export-csv').click()
    assert info.value.suggested_filename=='devlens-tokens.csv'
    page.locator('#token-filter').fill('not-present');assert 'По этому фильтру' in page.locator('#token-rows').inner_text()
    page.locator('#token-filter').fill('')
    page.set_viewport_size(dict(width=390,height=844))
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    page.wait_for_function("document.querySelector('#graph').scrollLeft>0")
    # A second request can be cancelled and does not strand the UI as busy.
    page.locator('#submit').click();page.wait_for_selector('#progress:not(.hidden)');page.locator('#cancel').click();assert 'остановлена' in page.locator('#error').inner_text()
    assert not errors, errors
    report=dict(passed=True,extension_bridge=True,offscreen_worker=True,analysis_roundtrip=True,csv_export=True,mobile_overflow=False,cancellation=True,page_errors=errors,fixture_requests=worker.evaluate('fixtureCalls.length'),evidence='Network fixtures; not a real on-chain analysis')
    (ROOT/'research/browser-smoke.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
    context.close()
