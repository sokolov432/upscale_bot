(() => {
  if(globalThis.DevLensChartCapture)return;
  const rect=n=>{const r=n.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};};
  function snapshot(){
    try{
      const roots=[document];for(const f of document.querySelectorAll('iframe'))try{if(f.contentDocument)roots.push(f.contentDocument);}catch{}
      const options=roots.flatMap(root=>[...root.querySelectorAll('canvas')].map(canvas=>({canvas,box:rect(canvas),root}))).filter(o=>o.box.w>=240 && o.box.h>=120 && o.canvas.width>0 && o.canvas.height>0 && o.box.x+o.box.w>0 && o.box.y+o.box.h>0 && o.box.x<o.root.defaultView.innerWidth && o.box.y<o.root.defaultView.innerHeight);
      options.sort((a,b)=>b.box.w*b.box.h-a.box.w*a.box.h);const main=options[0];if(!main)return {chart:null,chartStatus:'График недоступен для снимка: canvas не найден или находится в закрытом iframe.'};
      const scale=Math.min(1,1000/main.box.w),out=document.createElement('canvas');out.width=Math.round(main.box.w*scale);out.height=Math.round(main.box.h*scale);const ctx=out.getContext('2d');ctx.fillStyle='#10141a';ctx.fillRect(0,0,out.width,out.height);
      for(const o of options.filter(o=>o.root===main.root && Math.abs(o.box.x-main.box.x)<2 && Math.abs(o.box.y-main.box.y)<2 && Math.abs(o.box.w-main.box.w)<2 && Math.abs(o.box.h-main.box.h)<2).reverse())ctx.drawImage(o.canvas,0,0,out.width,out.height);
      const tiny=document.createElement('canvas');tiny.width=9;tiny.height=8;const t=tiny.getContext('2d',{willReadFrequently:true});t.drawImage(out,0,0,9,8);const p=t.getImageData(0,0,9,8).data,gray=i=>p[i]*.299+p[i+1]*.587+p[i+2]*.114;let bits=0n;for(let y=0;y<8;y++)for(let x=0;x<8;x++)bits=(bits<<1n)|BigInt(gray((y*9+x)*4)>gray((y*9+x+1)*4));
      const tf=[...document.querySelectorAll('[data-timeframe], button[aria-pressed="true"], [role="button"][aria-pressed="true"]')].map(n=>n.getAttribute('data-timeframe') || n.textContent.trim()).find(s=>/^(?:1|3|5|15|30|60)m$|^(?:1|4)h$|^1[dw]$/i.test(s)) || 'unknown';
      let preview=out.toDataURL('image/jpeg',.65);if(preview.length>180000)preview=null;
      return {chart:{hash:bits.toString(16).padStart(16,'0'),timeframe:tf.toLowerCase(),capturedAt:Date.now(),source:location.href,preview},chartStatus:'Сохранён доступный вид графика; сравнение только как слабый признак.'};
    }catch{return {chart:null,chartStatus:'Браузер ограничил чтение изображения графика. Снимок не сохранён.'};}
  }
  globalThis.DevLensChartCapture={snapshot};
})();
