import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
const qa = new URL(process.env.DATABASE_URL);
qa.pathname = '/nandra_qa_nalozi_20261120';
process.env.DATABASE_URL = qa.toString();
const { prisma: db } = await import('./lib/prisma.js');
const base = 'http://localhost:5500';
const pass = 'Nandra-local-QA-20261120!';
const date = '2026-11-20';
const uid = 'qa-' + randomUUID().slice(0, 6);
const stats = { OK: 0, FAIL: 0 };
function check(label, condition, detail = '') {
  const result = condition ? 'OK' : 'FAIL';
  stats[result]++;
  console.log(result, label, typeof detail === 'string' ? detail : JSON.stringify(detail));
}
async function call(method, path, cookie, body, key) {
  const res = await fetch(base + '/api' + path, {
    method, headers: { origin: 'http://localhost:5173', ...(cookie && {cookie}), ...(body && {'content-type':'application/json'}), ...(key && {'idempotency-key':key}) },
    ...(body && {body:JSON.stringify(body)})
  });
  const json = await res.json();
  return { status: res.status, json, cookie: res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ') };
}
async function status(label, expected, ...args) {
  const r = await call(...args);
  check(label, r.status === expected, r.status + (r.status !== expected ? ' ' + JSON.stringify(r.json).slice(0, 420) : ''));
  return r;
}
function order(res) { return res.json.workOrder || res.json; }
const accounts = {};
try {
  const password = await hashPassword(pass);
  for (const [key, role, linked, active] of [
    ['dir','DIREKTOR',true,true], ['mgr','RUKOVODILAC',true,true], ['wh','MAGACIN',true,true], ['mech','MEHANICAR',true,true],
    ['op','OPERATER',true,true], ['off','OPERATER',true,false], ['op-none','OPERATER',false,true], ['mech-none','MEHANICAR',false,true],
    ['wh-off','MAGACIN',false,true], ['op2','OPERATER',true,true]
  ]) {
    const email = uid + '.' + key + '@qa.example.com';
    const userId = randomUUID();
    const user = await db.user.upsert({where:{email},update:{isActive:active}, create:{id:userId,role,email,name:'QA '+key,isActive:active,
      accounts:{create:{accountId:userId,providerId:'credential',password}}}});
    let worker;
    if (linked || key === 'wh-off') worker = await db.worker.upsert({where:{userId:user.id},update:{},create:{name:user.name,userId:user.id,role,isActive:key !== 'wh-off'}});
    const login = await status('Prijava '+key, active ? 200 : 403, 'POST','/auth/sign-in/email',null,{email,password:pass});
    accounts[key] = {...user, worker, cookie:login.cookie};
  }
  const {dir,mgr,wh,mech,op,op2} = accounts;
  assert(dir.cookie && mgr.cookie && wh.cookie && mech.cookie && op.cookie && op2.cookie, 'Test login failed, no mutations sent');
  console.log('FIXTURE_PREFIX',uid);
  const later = await db.user.update({where:{id:op2.id},data:{isActive:false}});
  try { await status('Deaktiviran korisnik sa postojećom sesijom',403,'GET','/work-orders',op2.cookie); } finally {
    await db.user.update({where:{id:later.id},data:{isActive:true}});
  }
  for (const [method,path,data] of [['GET','/work-orders'],['POST','/work-orders',{}],['POST','/work-orders/unused/accept',{}]]) {
    await status('Bez sesije '+method+' '+path,401,method,path,null,data);
  }
  const newMachine = (suffix,data={}) => db.machine.create({data:{name:uid+' '+suffix,tankCapacityLiters:200,currentFuelLiters:80,currentHours:100,...data}});
  const [a,b,c,attachment,broken,archived] = await Promise.all([newMachine('Traktor A'),newMachine('Traktor B'),newMachine('Traktor C'),newMachine('Prikljucak',{type:'PRIKLJUCAK',tankCapacityLiters:null}),newMachine('Kvar',{status:'U_KVARU'}),newMachine('Arhivirana',{isActive:false})]);
  const [parcel, parcel2] = await Promise.all(['P1','P2'].map(code=>db.parcel.create({data:{code:uid+code,name:'QA '+code,areaHa:20}})));
  const [workType, special] = await Promise.all([
    db.workType.create({data:{name:uid+' Oranje',fuelNormLitersPerHa:12,laborPricePerHa:100,totalPricePerHa:250}}),
    db.workType.create({data:{name:uid+' Zastita', materialKind:'CHEMICAL',materialRequired:true}})
  ]);
  const chemical = await db.chemicalProduct.create({data:{name:uid+' Hemija',code:uid,unit:'L'}});
  const contractor = await db.contractor.create({data:{code:uid,name:uid+' Kooperant'}});
  const unlinked = await db.worker.create({data:{name:uid+' Nepovezan',role:'MAGACIN'}});
  const seasonal = await db.worker.create({data:{name:uid+' Sezonac',type:'SEZONAC'}});
  const lot = await db.onionLot.create({data:{lotNumber:uid+'-LOT',parcelId:parcel.id,initialQuantityKg:1000,rawStockKg:900,sortedQualityKg:100}});
  await db.onionStorageEntry.create({data:{lotId:lot.id,locationOrChamber:'QA Komora',quantityKg:250,currentQuantityKg:250,supervisorId:dir.id}});
  const field = {orderDate:date,orderType:'RAD_NJIVA',workerId:op.worker.id,machineId:a.id,attachmentId:attachment.id,parcelId:parcel.id,workTypeId:workType.id,contractorId:contractor.id,plannedAreaHa:6,instructions:uid+' QA rad'};
  const create = async (label, actor, data, expected=201,key) => order(await status(label,expected,'POST','/work-orders',actor.cookie,data,key));
  const detail = async (id, actor=dir) => order(await call('GET','/work-orders/'+id,actor.cookie));
  const input = {orderDate:date,orderType:'OSTALO',workerId:op.worker.id,instructions:uid+' QA ostalo'};
  const qaField = await create('DIREKTOR izdaje RAD_NJIVA',dir,field);
  assert(qaField.id, 'Cannot continue without field order');
  const mine = await create('RUKOVODILAC izdaje OSTALO',mgr,input);
  const serviceInput = {orderDate:date,orderType:'REMONT_SERVIS',workerId:mech.worker.id,machineId:c.id,serviceType:'REDOVAN_SERVIS',priority:'SREDNJA',instructions:uid+' servis'};
  const serviceKey = randomUUID();
  const repair = await create('REMONT_SERVIS izdavanje',mgr,serviceInput,201,serviceKey);
  const retry = await create('Ponovljeni Idempotency-Key vraća 201',mgr,serviceInput,201,serviceKey);
  check('Idempotentnost naloga i povezanog servisa',repair.id && repair.id === retry.id && repair.maintenanceId === retry.maintenanceId && (await db.maintenanceIssue.count({where:{machineId:c.id}}))===1);
  const workRoot = '/work-orders/';
  const patch = (label, expected, actor, id, state) => status(label,expected,'PATCH',workRoot+id+'/status',actor.cookie,{status:state});
  const edit = (label, expected, actor, id, data) => status(label,expected,'PUT',workRoot+id,actor.cookie,data);
  const del = (label, expected, actor, id) => status(label,expected,'DELETE',workRoot+id,actor.cookie);
  const accept = (label, expected, actor, id, data={}) => status(label,expected,'POST',workRoot+id+'/accept',actor.cookie,data);
  const getMachine = id=>db.machine.findUnique({where:{id}});
  const meter = async (id=a.id) => ({startFuelLiters:80,startHours:100,expectedMachineUpdatedAt:(await getMachine(id)).updatedAt.toISOString()});
  for (const role of [wh,mech,op]) {
    const own = role.id === op.id ? qaField : (role.id === mech.id ? repair : qaField);
    const foreign = role.id === op.id ? repair : qaField;
    await status(role.role+' kreiranje',403,'POST','/work-orders',role.cookie,input);
    await edit(role.role+' izmena',403,role,own.id,{instructions:'QA'});
    await patch(role.role+' otkazivanje',403,role,own.id,'OTKAZAN');
    await del(role.role+' brisanje',403,role,own.id);
    await status(role.role+' tuđi detalj',403,'GET',workRoot+foreign.id,role.cookie);
    await accept(role.role+' tuđe prihvatanje',403,role,foreign.id);
    const list = await status(role.role+' lista',200,'GET','/work-orders',role.cookie);
    check(role.role+' vidi samo svoje',list.json.workOrders?.every(row=>row.workerId === role.worker.id));
  }
  for (const key of ['op-none','mech-none']) await status('Lista bez radnika '+key,403,'GET','/work-orders',accounts[key].cookie);
  for (const u of [dir,mgr,op,mech]) {
    const r=await status(u.role+' work-types',200,'GET','/master/work-types',u.cookie);
    const list=Array.isArray(r.json)?r.json:r.json.workTypes;
    const sample=list?.find(row=>row.id===workType.id);
    check(u.role+' normativi i cene',sample && ['fuelNormLitersPerHa','laborPricePerHa','totalPricePerHa','referenceFuelPrice'].every(key=>Object.hasOwn(sample,key) === [dir.id,mgr.id].includes(u.id)));
  }
  const managerList = await call('GET','/work-orders?date='+date+'&limit=100',mgr.cookie);
  check('RUKOVODILAC lista objedinjuje više radnika',new Set(managerList.json.workOrders?.map(row=>row.workerId)).size >= 2);
  for (const key of ['parcelId','machineId']) {
    const v = {...field}; delete v[key];
    await create('RAD_NJIVA bez '+key,dir,v,400);
  }
  await create('RAD_NJIVA bez obaveznog materijala',dir,{...field,workTypeId:special.id},400);
  const material = {kind:'CHEMICAL',productId:chemical.id,dosePerHa:0.25,notes:'QA doza'};
  for (const invalid of [0,-1,'tekst']) await create('Materijal sa nevažećom dozom '+invalid,dir,{...field,workTypeId:special.id,materials:[{...material,dosePerHa:invalid}]},400);
  const materialsOrder = await create('Materijal sa dozom 0.25',dir,{...field,workTypeId:special.id,materials:[material]});
  await db.pushSubscription.create({data:{userId:op2.id,endpoint:'https://push.qa.invalid/'+uid,p256dh:'fixture',auth:'fixture'}});
  const earlierOutbox=await db.pushOutbox.count({where:{userId:op2.id}});
  await edit('Izmena otvorenog naloga',200,mgr,materialsOrder.id,{workerId:op2.worker.id,parcelId:parcel2.id,shift:'DRUGA',workTypeId:workType.id,priority:'HITNO',plannedAreaHa:7,instructions:'QA izmena'});
  const updated=await detail(materialsOrder.id);
  check('Sačuvana polja, očišćeni materijali i novi push zapis',updated.workerId===op2.worker.id && updated.parcelId===parcel2.id && updated.materials?.length===0 && updated.plannedAreaHa===7 && await db.pushOutbox.count({where:{userId:op2.id}})>earlierOutbox);
  await patch('Otkazivanje dodeljenog',200,dir,materialsOrder.id,'OTKAZAN');
  await patch('Reaktiviranje otkazanog',200,mgr,materialsOrder.id,'DODELJEN');
  await del('Brisanje naloga bez istorije',200,dir,materialsOrder.id);
  await status('Nalog obrisan',404,'GET',workRoot+materialsOrder.id,dir.cookie);

  check('Servis počinje otvoren i mašina ima SERVIS',repair.maintenance?.status==='OTVOREN' && (await getMachine(c.id)).status==='SERVIS');
  await edit('Servis ne dozvoljava promenu mašine',409,dir,repair.id,{machineId:b.id});
  await edit('Servis ne dozvoljava promenu statusa',409,dir,repair.id,{status:'U_TOKU'});
  await edit('Servis ažurira povezani kvar',200,dir,repair.id,{serviceType:'KVAR_NJIVA',priority:'VISOKA',instructions:'QA kvar izmena'});
  check('Povezan kvar i status mašine U_KVARU',(await getMachine(c.id)).status==='U_KVARU' && (await db.maintenanceIssue.findUnique({where:{id:repair.maintenanceId}})).serviceType==='KVAR_NJIVA');
  await accept('Prihvatanje povezanog remonta',200,mech,repair.id);
  await status('Završetak iz radionice',200,'POST','/maintenance/issues/'+repair.maintenanceId+'/resolve',mech.cookie,{repairNotes:'QA popravka završena'});
  check('Radionica zatvara nalog i oslobađa mašinu',(await detail(repair.id)).status==='ZAVRSEN' && (await getMachine(c.id)).status==='SLOBODNA');
  await del('Završen servis zaštićen od brisanja',409,dir,repair.id);
  const legacy = await db.workOrder.create({data:{orderNumber:uid+'-LEGACY',orderDate:new Date(date),orderType:'REMONT_SERVIS',workerId:mech.worker.id,issuedById:mgr.id,status:'DODELJEN'}});
  await accept('Stari servis bez maintenanceId',409,mech,legacy.id);
  const serviceCancel=await create('Servis za otkazivanje',dir,serviceInput);
  await patch('Otkazivanje servisa',200,dir,serviceCancel.id,'OTKAZAN');
  check('Otkazivanje servisa oslobađa mašinu i zatvara kvar',(await getMachine(c.id)).status==='SLOBODNA' && (await db.maintenanceIssue.findUnique({where:{id:serviceCancel.maintenanceId}})).status==='OTKAZAN');
  const serviceDel=await create('Servis za brisanje',dir,serviceInput);
  await del('Brisanje otvorenog servisa',200,dir,serviceDel.id);
  check('Brisanje servisa uklanja kvar i oslobađa mašinu',(await getMachine(c.id)).status==='SLOBODNA' && await db.maintenanceIssue.count({where:{id:serviceDel.maintenanceId}})===0);
  
  const plan={entryMode:'both',sortingForm:{inputQuantityKg:'40',qualityQuantityKg:'30',smallQuantityKg:'5',wasteQuantityKg:'3',plevaKg:'2'},
    packagingForm:{date,lotId:lot.id,sourceKey:'unstored',packageType:'DZAK_5KG',unitWeightKg:'5',palletsCount:'',packageCount:'4',packerCount:'2',palletNumber:'',packerNotes:'',responsiblePerson:'QA Magacin',notes:''}};
  const packing={orderDate:date,orderType:'PAKOVANJE',workerId:wh.worker.id,packingPlan:plan};
  for (const u of [op.worker,mech.worker,accounts['wh-off'].worker,unlinked,seasonal]) await create('PAKOVANJE odbija nedozvoljenog radnika '+u.name,dir,{...packing,workerId:u.id},u.isActive===false?409:400);
  for (const [k,v] of Object.entries({lotId:'',sourceKey:'name:empty',packageCount:'0',unitWeightKg:'0',responsiblePerson:'',packerCount:'31'})) {
    await create('PAKOVANJE neispravno '+k,dir,{...packing,packingPlan:{...plan,packagingForm:{...plan.packagingForm,[k]:v}}},400);
  }
  await create('PAKOVANJE odbija nejednake mase',dir,{...packing,packingPlan:{...plan,sortingForm:{...plan.sortingForm,qualityQuantityKg:'25'}}},400);
  const both=await create('PAKOVANJE izdavanje both',dir,packing);
  const sorting=await create('PAKOVANJE izdavanje sorting',mgr,{...packing,packingPlan:{...plan,entryMode:'sorting'}});
  const packaging=await create('PAKOVANJE izdavanje packaging',mgr,{...packing,packingPlan:{...plan,entryMode:'packaging',packagingForm:{...plan.packagingForm,sourceKey:''}}});
  const editedPack=await edit('Prva izmena plana pakovanja',200,dir,both.id,{orderUpdatedAt:both.updatedAt,packingPlan:{...plan,packagingForm:{...plan.packagingForm,packageCount:'5'}}});
  await edit('Stara verzija plana pakovanja',409,mgr,both.id,{orderUpdatedAt:both.updatedAt,workerId:mgr.worker.id});
  const updatedPlan=await detail(both.id);
  check('Prva izmena ostaje sačuvana',updatedPlan.packingPlan?.packagingForm.packageCount==='5');
  await edit('Izmena osveženog plana',200,mgr,both.id,{orderUpdatedAt:order(editedPack).updatedAt,workerId:mgr.worker.id});
  await patch('Otkazivanje pakovanja',200,mgr,both.id,'OTKAZAN');
  await edit('Izmena otkazanog pakovanja odbijena',409,dir,both.id,{instructions:'QA'});
  await status('Magacioner učitava dodeljeno pakovanje',200,'GET','/onion/work-orders',wh.cookie);
  await status('Magacioner potvrđuje sortiranje iz druge lokacije',201,'POST','/onion/sorting',wh.cookie,{lotId:lot.id,date,sourceKey:'name:qa komora',
    inputQuantityKg:40,qualityQuantityKg:30,smallQuantityKg:5,wasteQuantityKg:3,plevaKg:2,workOrderId:sorting.id,orderUpdatedAt:sorting.updatedAt});
  const donePack=await detail(sorting.id);
  check('Pakovanje završeno, potpis i različita lokacija',donePack.status==='ZAVRSEN' && donePack.packingPlan?.execution?.actorName===wh.name && donePack.packingPlan?.execution?.sourceKey==='name:qa komora');
  await edit('Izmena završenog pakovanja odbijena',409,dir,sorting.id,{instructions:'QA'});
  await patch('Otkazivanje završenog pakovanja odbijeno',409,dir,sorting.id,'OTKAZAN');
  await del('Brisanje završenog pakovanja odbijeno',409,dir,sorting.id);
  await status('Storno završenog pakovanja',200,'POST','/onion/work-orders/'+sorting.id+'/reverse',dir.cookie,{action:'cancel',reason:'QA storno',updatedAt:donePack.updatedAt});
  await patch('Reaktiviranje storniranog pakovanja odbijeno',409,dir,sorting.id,'DODELJEN');
  await del('Brisanje storniranog pakovanja odbijeno',409,dir,sorting.id);
  const bothFresh = await create('Nalog za objedinjeno izvršenje',mgr,packing);
  for (const [pOrder, sortingInputs, mode] of [[packaging,undefined,'packaging'],[bothFresh,{inputQuantityKg:40,qualityQuantityKg:30,smallQuantityKg:5,wasteQuantityKg:3,plevaKg:2},'both']]) {
    await status('Magacioner izvršava režim '+mode,201,'POST','/onion/packaging',wh.cookie,{
      lotId:lot.id,date,sourceKey:sortingInputs?'unstored':undefined,packageType:'DZAK_5KG',unitWeightKg:5,packageCount:4,responsiblePerson:'QA Magacin',
      sorting:sortingInputs,workOrderId:pOrder.id,orderUpdatedAt:pOrder.updatedAt});
    const done=await detail(pOrder.id);
    check('Skladište evidentira izabrani režim '+mode,done.status==='ZAVRSEN' && done.packingPlan?.execution?.entryMode===mode && done.packingPlan?.execution?.actorName===wh.name);
  }
  
  const conflict = await create('Drugi nalog na istoj mašini',mgr,field);
  await accept('Previše goriva',400,op,qaField.id,{...await meter(),startFuelLiters:201});
  await accept('Negativno gorivo',400,op,qaField.id,{...await meter(),startFuelLiters:-1});
  await accept('Negativni radni sati',400,op,qaField.id,{...await meter(),startHours:-1});
  await accept('Staro očitavanje',409,op,qaField.id,{...await meter(),expectedMachineUpdatedAt:'2020-01-01T00:00:00.000Z'});
  const simultaneous=await Promise.all([qaField.id,conflict.id].map(async id=>call('POST',workRoot+id+'/accept',op.cookie,await meter())));
  check('Paralelno prihvatanje iste mašine daje 200 i 409',simultaneous.map(x=>x.status).sort().join() === '200,409',simultaneous.map(x=>x.status));
  const activeField=simultaneous[0].status===200?qaField:conflict;
  const linkedAssignment=await db.machineAssignment.findFirst({where:{workOrderId:activeField.id,status:'ZADUZENA'}});
  check('Nalog U_TOKU, mašina ZADUZENA, jedno zaduženje',(await detail(activeField.id)).status==='U_TOKU' && (await getMachine(a.id)).status==='ZADUZENA' && linkedAssignment && await db.machineAssignment.count({where:{machineId:a.id,status:'ZADUZENA'}})===1);
  await patch('Ne otkazuje se aktivno zaduženje',409,dir,activeField.id,'OTKAZAN');
  await edit('Zaključana mašina u toku',409,dir,activeField.id,{machineId:b.id});
  await edit('Zaključan radnik u toku',409,dir,activeField.id,{workerId:op2.worker.id});
  await del('Aktivno zaduženje štiti nalog od brisanja',409,dir,activeField.id);
  const brokenOrder=await create('Nalog na neispravnoj mašini',dir,{...field,machineId:c.id});
  await db.machine.update({where:{id:c.id},data:{status:'U_KVARU'}});
  await accept('Konflikt mašine u kvaru',409,op,brokenOrder.id,await meter(c.id));
  await db.machine.update({where:{id:c.id},data:{status:'SLOBODNA',isActive:false}});
  await accept('Konflikt naknadno arhivirane mašine',409,op,brokenOrder.id,await meter(c.id));
  await accept('OSTALO bez mašine',200,op,mine.id);
  await status('OSTALO kratak opis',400,'POST',workRoot+mine.id+'/complete',op.cookie,{notes:'no',workHours:0});
  await status('OSTALO završeno',200,'POST',workRoot+mine.id+'/complete',op.cookie,{notes:'QA posao završen',workHours:0});
  check('OSTALO završen bez zaduženja',(await detail(mine.id)).status==='ZAVRSEN' && await db.machineAssignment.count({where:{workOrderId:mine.id}})===0);
  const attachmentOrder=await create('OSTALO sa priključkom bez rezervoara',dir,{...input,machineId:attachment.id});
  await accept('Zaduženje priključka bez goriva u ime radnika',200,dir,attachmentOrder.id,{startHours:100,startFuelLiters:0,expectedMachineUpdatedAt:(await getMachine(attachment.id)).updatedAt.toISOString()});
  await status('OSTALO ne završava sa zaduženom mašinom',409,'POST',workRoot+attachmentOrder.id+'/complete',op.cookie,{notes:'QA opis',workHours:1});

  if (linkedAssignment) {
    await status('RAD_NJIVA završetak i razduženje',201,'POST','/field-work',op.cookie,{
      date,parcelId:parcel.id,machineId:a.id,attachmentId:attachment.id,workTypeId:workType.id,areaDoneHa:6,workHours:2,workOrderId:activeField.id,
      endHours:102,endFuelLiters:70,expectedMachineUpdatedAt:(await getMachine(a.id)).updatedAt.toISOString(),
      usageAreas:[{assignmentId:linkedAssignment.id,areaDoneHa:6}],
      machineReturns:[{assignmentId:linkedAssignment.id,endHours:102,endFuelLiters:70,expectedMachineUpdatedAt:(await getMachine(a.id)).updatedAt.toISOString()}]});
    const completed=await detail(activeField.id);
    check('RAD_NJIVA sačuvan rad, razdužena mašina i završen nalog',completed.fieldWorkId && completed.status==='ZAVRSEN' && (await getMachine(a.id)).status==='SLOBODNA' && (await getMachine(a.id)).currentFuelLiters===70);
    await del('Istorija rada štiti pred brisanjem',409,dir,activeField.id);
  }
  const usage = async (id, actor=dir) => (await call('GET','/machine-usage/order/'+id,actor.cookie)).json;
  const current = await usage(activeField.id,op);
  check('Operater može da menja mašinu na radu od danas',current.canEdit===true);
  const olderDate='2026-11-19T09:00:00.000Z';
  const older=await db.workOrder.create({data:{orderNumber:uid+'-OLDER',orderDate:new Date(olderDate),orderType:'RAD_NJIVA',workerId:op.worker.id,machineId:a.id,parcelId:parcel.id,issuedById:dir.id,status:'ZAVRSEN'}});
  check('Operater ne može da menja jučerašnji rad, direktor može',(await usage(older.id,op)).canEdit===false && (await usage(older.id,dir)).canEdit===true);
  if(current.work) {
    const ids=current.assignments.filter(x=>!x.voidedAt).map(x=>x.id);
    const allocate=(label,code,area,segment)=>status(label,code,'POST','/machine-usage/allocate',dir.cookie,{contextType:'order',contextId:activeField.id,version:current.version,reason:'QA raspodela',
      areaDoneHa:area,allocations:ids.map(id=>({id,areaDoneHa:segment}))});
    await allocate('Raspodela odbija neusaglašen zbir',400,6,5);
    await allocate('Raspodela odbija više od 120% parcele',400,25,25);
    await allocate('Raspodela prihvata usaglašen zbir',200,7,7);
    await allocate('Raspodela odbija zastarelu verziju',409,8,8);
    check('Upisana ispravka hektara',(await usage(activeField.id)).work?.areaDoneHa===7);
  }
  const upload = async (name, type, data) => {
    const form=new FormData(); form.set('file',new Blob([data],{type}),name);
    return fetch(base+'/api/photos/upload',{method:'POST',headers:{cookie:dir.cookie},body:form});
  };
  check('Nepodržana fotografija odbijena',(await upload('sample.txt','text/plain','qa')).status===400);
  check('Fotografija veća od 32 MB odbijena',(await upload('oversize.jpg','image/jpeg',new Uint8Array(32*1024*1024+1))).status===413);
  const bulkDate='2026-11-25';
  const tomorrow='2026-11-21';
  const fixture=(id,d,s='DODELJEN')=>({orderNumber:uid+'-B'+id,orderDate:new Date(d),orderType:'OSTALO',workerId:op.worker.id,issuedById:dir.id,status:s});
  await db.workOrder.createMany({data:[...Array.from({length:101},(_,i)=>fixture(i,bulkDate,i<26?'U_TOKU':'DODELJEN')),fixture('local','2026-11-20T23:30:00Z'),fixture('tomorrow',tomorrow)]});
  const page1=(await call('GET','/work-orders?date='+bulkDate+'&type=OSTALO',dir.cookie)).json;
  const page2=(await call('GET','/work-orders?date='+bulkDate+'&type=OSTALO&status=U_TOKU&page=2',dir.cookie)).json;
  const page5=(await call('GET','/work-orders?date='+bulkDate+'&type=OSTALO&page=5',dir.cookie)).json;
  check('101 nalog, 25 na prvoj strani, 1 na petoj',page1.pagination?.total===101 && page1.workOrders?.length===25 && page5.workOrders?.length===1);
  check('Filter statusa ne sužava KPI',page2.pagination?.total===26 && page2.workOrders?.length===1 && page2.stats?.totalOrders===101 && page2.stats?.pendingOrders===75 && page2.stats?.inProgressOrders===26);
  const nightToday=(await call('GET','/work-orders?date='+date+'&type=OSTALO&limit=100',dir.cookie)).json;
  const nightTomorrow=(await call('GET','/work-orders?date='+tomorrow+'&type=OSTALO&limit=100',dir.cookie)).json;
  check('Datum seče po UTC, nalog u 00:30 Beograd ostaje u prethodnom danu',nightToday.workOrders?.some(o=>o.orderNumber===uid+'-Blocal') && !nightTomorrow.workOrders?.some(o=>o.orderNumber===uid+'-Blocal'));
  const audits=await db.auditLog.findMany({where:{entityId:{in:[qaField.id,repair.id,sorting.id,mine.id]}},select:{entityId:true,userName:true,userRole:true}});
  check('Revizija beleži ime i ulogu svih učesnika',[dir,mgr,wh,mech,op].every(u=>audits.some(row=>row.userName===u.name && row.userRole===u.role)),audits.length);
  const cors=await fetch(base+'/api/work-orders',{headers:{origin:'https://qa-unrelated.example'}});
  console.log('INFO CORS konfiguracija, odgovor bez sesije', cors.status, cors.headers.get('access-control-allow-origin'),cors.headers.get('access-control-allow-credentials'));
  console.log('ZBIR',JSON.stringify(stats),'fixtures',uid);
} finally {
  await db.$disconnect();
}
