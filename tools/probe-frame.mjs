// Verifica que el MARCO (frame) deja ver el AVATAR a traves de su hueco central.
// Estrategia: tras cargar la pagina (menu), inyecta una tarjeta de PRUEBA con
// los MISMOS clases/estructura/URLs que `buildPlayerCard` (avatar + frame
// absoluto encima). Es una replica fiel del DOM real, sin depender del estado
// del perfil. Luego lee el pixel central: si el frame fuera opaco (bug), el
// pixel seria negro; con el fix, debe ser el color del HONGO (claro, blanco
// o cian/violeta del sombrero).
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PWC=['C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js'];
async function loadPlaywright(){try{return await import('playwright-core');}catch{for(const c of PWC)if(existsSync(c))return await import(pathToFileURL(c).href);throw new Error('no pw');}}
const pw=await loadPlaywright(); const chromium=pw.chromium??pw.default?.chromium;
const exe=['C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe','C:/Users/emanu/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'].find(p=>existsSync(p));
const b=await chromium.launch({executablePath:exe,headless:true,args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const ctx=await b.newContext({viewport:{width:915,height:412},isMobile:true,hasTouch:true});

const p=await ctx.newPage();
p.on('console',m=>{if(m.type()==='error')console.log('  [err]',m.text())});
p.on('pageerror',e=>console.log('  [pageerror]',e.message));
await p.goto('http://127.0.0.1:1420/?daily=0&quality=high',{waitUntil:'load',timeout:45000});
await p.waitForTimeout(2000);

// (a) Alpha real del centro de cada frame webp (cargando como <img>).
const alphaInfo = await p.evaluate(async () => {
  const probe = (u) => new Promise(res => {
    const i = new Image();
    i.onload = () => {
      const c = document.createElement('canvas'); c.width=i.naturalWidth; c.height=i.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(i,0,0);
      const cx=(i.naturalWidth/2)|0, cy=(i.naturalHeight/2)|0;
      const d = x.getImageData(cx-2, cy-2, 5, 5).data;
      let s=0; for(let k=3;k<d.length;k+=4) s+=d[k];
      res({ url:u, w:i.naturalWidth, h:i.naturalHeight, alphaCenter5x5: Math.round(s/(d.length/4)) });
    };
    i.onerror=()=>res({url:u,error:'load'});
    i.src=u;
  });
  return {
    common: await probe(new URL('art/art_frame_frame_common.webp', document.baseURI).href),
    uncommon: await probe(new URL('art/art_frame_frame_uncommon.webp', document.baseURI).href),
  };
});
console.log('(a) alpha centro de los frames:');
console.log('   common  :', JSON.stringify(alphaInfo.common));
console.log('   uncommon:', JSON.stringify(alphaInfo.uncommon));

// (b) Inyectar tarjeta de prueba y leer pixel central de la composicion.
const sample = await p.evaluate(async () => {
  const baseURI = document.baseURI;
  const avatarUrl = new URL('art/art_avatar_avatar.webp', baseURI).href;
  const frameUncommonUrl = new URL('art/art_frame_frame_uncommon.webp', baseURI).href;
  const frameCommonUrl = new URL('art/art_frame_frame_common.webp', baseURI).href;

  // Replica EXACTA de buildPlayerCard: mismo wrapper, mismas clases, mismo z-order.
  const mk = (frameUrl) => {
    const wrap = document.createElement('div');
    wrap.className = 'player-card';
    wrap.style.cssText = 'position:fixed; top:60px; left:20px; z-index:9999; padding:20px; background:#222;';
    const inner = document.createElement('div');
    inner.className = 'player-card-inner';
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'player-card-avatar';
    const av = document.createElement('img');
    av.className = 'player-card-avatar-img'; av.src = avatarUrl; av.alt = ''; av.decoding='async';
    avatarWrap.appendChild(av);
    if (frameUrl) {
      const fr = document.createElement('img');
      fr.className = 'player-card-frame'; fr.src = frameUrl; fr.alt=''; fr.decoding='async';
      avatarWrap.appendChild(fr);
    }
    inner.appendChild(avatarWrap);
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    return { wrap, avatarWrap };
  };

  const waitImg = (img) => new Promise(r => { if (img.complete && img.naturalWidth) r(); else { img.onload=()=>r(); img.onerror=()=>r(); } });
  const readCenter = async (frameUrl) => {
    const { wrap, avatarWrap } = mk(frameUrl);
    const av = avatarWrap.querySelector('.player-card-avatar-img');
    const fr = avatarWrap.querySelector('.player-card-frame');
    await waitImg(av);
    if (fr) await waitImg(fr);
    // Dar un instante a que el layout se asiente.
    await new Promise(r => setTimeout(r, 50));
    const W = Math.ceil(avatarWrap.getBoundingClientRect().width);
    const H = Math.ceil(avatarWrap.getBoundingClientRect().height);
    // Replicar la composicion REAL: clip circular del avatar + frame encima con
    // su alpha real. Asi, si el frame fuera opaco (bug), veriamos su RGB donde
    // deberia estar el hongo.
    const c = document.createElement('canvas'); c.width=W; c.height=H;
    const x = c.getContext('2d');
    // Fondo magenta: si el frame tapara todo, veriamos magenta en el centro
    // (alpha 0 -> magenta pasa). Esto detecta visualmente la regresion.
    x.fillStyle = '#ff00ff'; x.fillRect(0,0,W,H);
    x.save(); x.beginPath(); x.arc(W/2, H/2, W/2, 0, Math.PI*2); x.clip();
    x.drawImage(av, 0, 0, W, H); x.restore();
    if (fr) {
      // CSS: frame absolute inset:-6px (W+12 x H+12), object-fit:contain.
      x.drawImage(fr, -6, -6, W+12, H+12);
    }
    const cx=(W/2)|0, cy=(H/2)|0;
    const dCenter = x.getImageData(cx, cy, 1, 1).data;
    // Ventana 5x5 para robustez (por si un pixel cae justo en el borde del hongo).
    const d5 = x.getImageData(cx-2, cy-2, 5, 5).data;
    let rS=0,gS=0,bS=0,aS=0;
    for (let k=0;k<d5.length;k+=4){rS+=d5[k];gS+=d5[k+1];bS+=d5[k+2];aS+=d5[k+3];}
    const n = d5.length/4;
    const out = {
      ok: true,
      avatarRect: avatarWrap.getBoundingClientRect(),
      center: { r:dCenter[0], g:dCenter[1], b:dCenter[2], a:dCenter[3] },
      center5x5: { r:Math.round(rS/n), g:Math.round(gS/n), b:Math.round(bS/n), a:Math.round(aS/n) },
    };
    wrap.remove();
    return out;
  };

  // 1) Solo avatar (control: NO hay frame -> vemos el hongo directo).
  const noFrame = await readCenter(null);
  // 2) Avatar + frame_uncommon (centro transparente -> hongo visible).
  const withUncommon = await readCenter(frameUncommonUrl);
  // 3) Avatar + frame_common.
  const withCommon = await readCenter(frameCommonUrl);

  return { noFrame, withUncommon, withCommon };
});
console.log('(b) composicion (pixel central del avatar+frame):');
console.log(JSON.stringify(sample, null, 2));

// Screenshot para ojo humano (con la tarjeta real del menu visible).
await p.screenshot({ path: 'tools/shots/frame-probe.png' });
console.log('screenshot -> tools/shots/frame-probe.png');

await b.close();
