import { writeFile } from 'node:fs/promises';
const debug = 'http://localhost:9228';
const app = 'http://localhost:5573';
const prefix = process.argv[2] || 'qa-d8090f';
const browser = new WebSocket((await (await fetch(debug+'/json/version')).json()).webSocketDebuggerUrl);
await new Promise((yes,no)=>{browser.addEventListener('open',yes,{once:true});browser.addEventListener('error',no,{once:true});});
const pending=new Map(), errors=new Map();
let id=0, pass=0, fail=0;
browser.addEventListener('message',e=>{
  const m=JSON.parse(e.data);
  if(m.id){const item=pending.get(m.id); if(!item)return; pending.delete(m.id); if(m.error)item.no(Error(m.error.message));else item.yes(m.result);}
  if(m.method==='Runtime.exceptionThrown') errors.get(m.sessionId)?.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));
});
const cdp=(method,params={},sessionId)=>new Promise((yes,no)=>{const i=++id;pending.set(i,{yes,no});browser.send(JSON.stringify({id:i,method,params,sessionId}));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=8000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){try {const result=await fn();if(result)return result;} catch {} await sleep(150);}
  throw Error('timeout '+label);
}
function check(label,cond,detail=''){
  if(cond)pass++; else fail++;
  console.log(cond?'OK':'FAIL',label,typeof detail==='string'?detail:JSON.stringify(detail));
}
async function page(width=1250) {
  const {browserContextId}=await cdp('Target.createBrowserContext');
  const {targetId}=await cdp('Target.createTarget',{url:'about:blank',browserContextId});
  const {sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
  errors.set(sessionId,[]);
  const cmd=(m,p)=>cdp(m,p,sessionId);
  await cmd('Runtime.enable'); await cmd('Page.enable'); await cmd('Network.enable');
  await cmd('Emulation.setTimezoneOverride',{timezoneId:'Europe/Belgrade'});
  await cmd('Emulation.setDeviceMetricsOverride',{width,height:820,deviceScaleFactor:1,mobile:width<500});
  const js=async (expression)=>{
    const {result,exceptionDetails}=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(exceptionDetails)throw Error(exceptionDetails.exception?.description||exceptionDetails.text);
    return result.value;
  };
  const click=async (text,selector='button,a',exact=true)=>js('(()=>{const e=[...document.querySelectorAll('+JSON.stringify(selector)+')].find(e=>e.getClientRects().length&&( '+(exact?'e.innerText.trim() === ':'e.innerText.includes(')+JSON.stringify(text)+(exact?'':')')+'));if(!e)return false;e.click();return true})()');
  const nav=url=>cmd('Page.navigate',{url:app+url});
  const body=()=>js("document.body?.innerText||''");
  const path=()=>js("location.pathname");
  const waitText=(text,ms)=>until(async()=>(await body()).includes(text),text,ms);
  const visible=selector=>js('[...document.querySelectorAll('+JSON.stringify(selector)+')].filter(e=>e.getClientRects().length).length');
  const fill=(selector,value)=>js('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');if(!el)return false;const p=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(el,'+JSON.stringify(value)+');el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
  return {cmd,js,click,nav,body,path,waitText,visible,fill,errors:()=>errors.get(sessionId),close:()=>cdp('Target.disposeBrowserContext',{browserContextId})};
}
async function login(p,role) {
  await p.nav('/');
  await until(()=>p.visible('#email'),'login form');
  await p.fill('#email',prefix+'.'+role+'@qa.example.com'); await p.fill('#password','Nandra-local-QA-20261120!');
  await p.click('Prijavi se');
  await until(async()=>!(await p.visible('#email')) && (await p.body()).length>50,'logging in '+role,12000);
  await sleep(600);
  return p.path();
}
const navLink = "a[href='/nalozi']";
try {
  const guest=await page();
  try {
    await guest.nav('/nalozi');
    await until(()=>guest.visible('#email'),'guest login route',12000);
    check('Anonimni /nalozi vodi na / i prikazuje prijavu',await guest.path()==='/');
  } finally {await guest.close();}
  for (const [role,route,width] of [['dir','/nalozi',1250],['mgr','/nalozi',1250],['wh','/magacin-djubrivo',1250],['mech','/',360],['op','/',414]]) {
    const p=await page(width);
    try {
      const landing=await login(p,role);
      check(role+' putanja nakon prijave',landing===route,landing);
      await p.nav('/nalozi');
      if(role==='wh'){
        await until(async()=>await p.path()==='/magacin-djubrivo','warehouse redirect');
        check('MAGACIN ručni /nalozi vraća na magacin i nema link',await p.path()==='/magacin-djubrivo' && !(await p.visible(navLink)));
        await p.nav('/modul-luk?tab=nalozi');
        await p.waitText('Radni nalozi za pakovanje',12000);
        check('MAGACIN otvara modul Luk i tab naloga',await p.path()==='/modul-luk');
      } else {
        await p.waitText('UKUPNO NALOGA',12000);
        const manager=['dir','mgr'].includes(role);
        const actual=(await p.body());
        check(role+' pristup /nalozi i KPI po ulozi',await p.path()==='/nalozi' && /(^|\n)ZAVRŠENO(\n|$)/.test(actual)===manager);
        check(role+' dugme za izdavanje prema ulozi',actual.includes('Izdaj novi nalog')===manager);
        check(role+' podrazumevani status',actual.includes(manager?'Svi statusi':'Aktivni nalozi'));
        if(width>500) check(role+' link u sidebaru',await p.visible(navLink)>0);
        else {
          const layout=await p.js("({width:innerWidth,scroll:document.documentElement.scrollWidth})");
          check(role+' mobilni prikaz bez horizontalnog prekoračenja',layout.width===width && layout.scroll===width,layout);
          if(await p.click('Aktivni nalozi')){
            await p.waitText('Samo Dodeljen');
            check(role+' otvara filter statusa na telefonu',(await p.body()).includes('Samo U toku'));
            await p.click('Aktivni nalozi');
          }
        }
        if(role==='mgr'){
          await p.fill('input[type=date]','2026-11-25');
          await p.waitText('Prikazano 1',5000).catch(()=>{});
          console.log('INFO paginacija',await p.js("[...document.querySelectorAll('button[title]')].map(x=>x.title).slice(-25)"));
          await p.click('Danas');
          await p.fill('input[type=date]','2026-11-20');
          await p.waitText('Prikazano',5000).catch(()=>{});
          const list=await p.body();
          console.log('INFO prikaz liste',list.split('\n').filter(x=>/Prikazano|Slede|Poslednja/i.test(x)).slice(0,7));
          await sleep(400);
          const detail=await p.js("(()=>{const e=[...document.querySelectorAll('button')].find(x=>/^#RN-/.test(x.innerText.trim()));if(!e)return false;e.click();return true})()");
          check('RUKOVODILAC može kliknuti broj naloga',detail);
          if(detail){
            await p.waitText('Izmeni nalog');
            check('RUKOVODILAC otvara detalje naloga i vidi Izmeni nalog', (await p.body()).includes('Izmeni nalog'));
            await p.click('Izmeni nalog');
            await p.waitText('Sačuvaj izmene');
            check('Dugme detalja otvara formu izmene',(await p.body()).includes('Sačuvaj izmene'));
            await p.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
            await p.nav('/nalozi'); await p.waitText('Izdaj novi nalog');
          }
          await p.click('Izdaj novi nalog');
          await p.waitText('Sačuvaj i izdaj nalog');
          console.log('INFO forma', (await p.body()).split('\n').slice(-66).join(' | '));
          check('Forma izdavanja se otvara', (await p.body()).includes('Sačuvaj i izdaj nalog'));
          await p.click('Sačuvaj i izdaj nalog');
          await sleep(150);
          check('Prazna forma ne šalje nalog', (await p.body()).includes('Sačuvaj i izdaj nalog'));
        }
        if(role==='dir') {
          await p.cmd('Network.setBlockedURLs',{urls:['http://localhost:5500/api/work-orders?*']});
          await p.nav('/nalozi');
          await p.waitText('Radni nalozi nisu učitani.',14000);
          check('Prekid učitavanja prikazuje kontrolu za ponovni pokušaj',(await p.body()).includes('Pokušaj ponovo'));
          await p.cmd('Network.setBlockedURLs',{urls:[]});
          await p.click('Pokušaj ponovo');
          await p.waitText('UKUPNO NALOGA',12000);
          check('Ponovni pokušaj vraća prikaz naloga',true);
        }
        if(role==='op') {
          const data=await p.body();
          check('Operater nema menadžerske opcije na karticama',!['Izmeni','Otkaži','Aktiviraj','Obriši'].some(x=>data.split('\n').includes(x)));
        }
      }
      check(role+' bez neobrađenih JS grešaka',p.errors().length===0,p.errors().map(x=>x.slice(0,320)));
    } catch(e){check(role+' scenario',false,e.message); console.log('INFO stanje', (await p.body()).split('\n').slice(0,40).join(' | '));}
    finally {await p.close();}
  }
  console.log('ZBIR',JSON.stringify({pass,fail}));
} finally {browser.close();}
