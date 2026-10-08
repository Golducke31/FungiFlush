import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const PW='C:/Users/emanu/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js';
const pw=await import(pathToFileURL(PW).href); const chromium=pw.chromium??pw.default?.chromium;
const exe='C:/Users/emanu/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
if(!existsSync(exe)){console.error('No hay Chromium.');process.exit(1);}
mkdirSync('tools/shots',{recursive:true});
const b=await chromium.launch({executablePath:exe,headless:true,args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--disable-dev-shm-usage']});
const c=await b.newContext({viewport:{width:915,height:412},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const p=await c.newPage();
await p.goto('http://127.0.0.1:1420/?daily=0',{waitUntil:'load',timeout:45000});
await p.waitForFunction(()=>Boolean(window.__fungiflush?.engine?.run),{timeout:30000});
await p.waitForTimeout(2200);
await p.evaluate(()=>document.querySelector('[data-act="tutorial-close"]')?.click()); await p.waitForTimeout(300);
await p.evaluate(()=>document.querySelector('.panel.is-menu [data-act="new"]')?.click()); await p.waitForTimeout(1200);
await p.evaluate(()=>document.querySelector('.panel.is-archetypes [data-act="archetypes-start"]')?.click()); await p.waitForTimeout(1400);
await p.evaluate(()=>document.querySelector('[data-act="tutorial-close"]')?.click()); await p.waitForTimeout(700);
await p.evaluate(()=>{const f=window.__fungiflush;f.engine.chooseBlind(f.engine.availableBlinds()[0]?.id);});
await p.waitForFunction(()=>(window.__fungiflush?.engine?.round?.hand?.length??0)>0,{timeout:15000});
await p.waitForTimeout(1500);
// Simbiontes para ver la caja compacta
await p.evaluate(()=>{const f=window.__fungiflush;if(f.engine.run.jokers.length===0){const id=f.content.registry.poolOf('joker')[0]?.id;if(id)f.engine.run.jokers.push(f.engine.registry.instantiateJoker(id));}f.hud.refreshPanel?.();});
await p.waitForTimeout(800);
// Seleccionar 2 cartas de familias distintas y jugar
await p.evaluate(()=>{const f=window.__fungiflush;const h=f.engine.round.hand;const m=new Map();for(const x of h){if(!m.has(x.def.family))m.set(x.def.family,x);if(m.size>=2)break;}for(const x of m.values()){if(!f.engine.round.selected.includes(x.uid))f.engine.toggleSelect(x.uid);}});
await p.waitForTimeout(600);
await p.screenshot({path:'tools/shots/hud-fixes-seleccion.png'});
await p.evaluate(()=>{const btn=document.querySelector('.hud-actions .btn.is-play');if(btn&&!btn.disabled)btn.click();});
await p.waitForFunction(()=>document.querySelector('.hud-consequence')?.classList.contains('is-visible'),{timeout:12000}).catch(()=>{});
await p.waitForTimeout(500);
await p.screenshot({path:'tools/shots/hud-fixes-consecuencia.png'});
console.log('listo');
await b.close();
