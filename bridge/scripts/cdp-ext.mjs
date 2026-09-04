import WebSocket from 'ws';
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const t = targets.find(t => t.url.startsWith('chrome://extensions'));
if (!t) { console.log('open chrome://extensions first'); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
const reload = process.argv.includes('--reload');
const expr = `(async()=>{const l=await chrome.developerPrivate.getExtensionsInfo(); const d=l.find(e=>e.name==='Diorama'); ${reload ? "await chrome.developerPrivate.reload(d.id,{failQuietly:true}); await new Promise(r=>setTimeout(r,2500)); const l2=await chrome.developerPrivate.getExtensionsInfo(); const e=l2.find(e=>e.name==='Diorama');" : "const e=d;"} return {id:e.id,state:e.state,runtimeErrors:e.runtimeErrors.map(x=>x.message+' @ '+x.source),manifestErrors:e.manifestErrors.map(x=>x.message),views:e.views.map(v=>v.url)}})()`;
ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })));
ws.on('message', d => { const m = JSON.parse(d); if (m.id === 1) { console.log(JSON.stringify(m.result?.result?.value ?? m, null, 1)); ws.close(); } });
