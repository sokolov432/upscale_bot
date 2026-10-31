import {addressFromInput} from './engine.mjs';
document.querySelector('#open').onclick=()=>{try{const ca=addressFromInput(document.querySelector('#ca').value);chrome.tabs.create({url:'https://sokolov432.github.io/upscale_bot/?ca='+encodeURIComponent(ca)});}catch(e){document.querySelector('#error').textContent=e.message;}};
document.querySelector('#settings').onclick=()=>chrome.runtime.openOptionsPage();
