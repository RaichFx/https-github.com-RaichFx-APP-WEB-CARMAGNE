import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes as strip } from 'node:module';
import * as cryptoModule from 'node:crypto';
const regSource = readFileSync(new URL('../api/auth/register-worker.ts', import.meta.url), 'utf8');
const atomicSource = 'export const createFirestoreDocumentsAtomically' + readFileSync(new URL('../server/firebaseAdminRest.ts', import.meta.url), 'utf8').split('export const createFirestoreDocumentsAtomically')[1];
const rateSource = readFileSync(new URL('../server/security/rateLimit.ts', import.meta.url), 'utf8');
const regJS = strip(regSource).replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '').replace(/export const /g, 'const ').replace('export default async function handler', 'return async function handler');
const notes = [];
function makeHarness(options = {}) {
 const writes = [], rates = [];
 let telegram = 0;
 const mocks = {
 createHash: cryptoModule.createHash, randomUUID: cryptoModule.randomUUID,
 hashSecret: p => 'hash:' + p,
 isSpanishPhone: p => /^\+34[6789]\d{8}$/.test(p),
 normalizeSpanishPhone: p => p.startsWith('+34') ? p : '+34' + p,
 queryFirestoreByField: async(c, f) => options.existing === f ? [{id:'existing'}] : [],
 queryFirestoreBySpanishPhone: async() => options.existing === 'phone' ? [{id:'existing'}] : [],
 createFirestoreDocumentsAtomically: async docs => {writes.push(docs); if(options.dbError) throw Error('db'); return !options.conflict;},
 requireRole: async() => {if(options.authError) throw Error('denied'); return {uid:'admin-test',role:'ADMIN'};},
 sendApiError: res => res.status(403).json({error:'denied'}),
 checkRateLimit: (...args) => {rates.push(args); return {allowed:!options.limited,retryAfterSeconds:25,remaining:1};},
 writeSecurityAudit: () => {},
 sendTelegramMessage: async() => {telegram++; if(options.telegramError) throw Error('notification');},
 process: {env:{}}, console: {error:()=>{}},
 };
 const handler = Function(...Object.keys(mocks), regJS)(...Object.values(mocks));
 return {writes,rates,get telegram(){return telegram;},async call(body,headers={},method='POST'){
 const res={code:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
 await handler({method,headers,body,socket:{remoteAddress:'test-client'}},res);return res;
 }};
}
const valid={name:'Usuario de prueba',dni:'12345678Z',phone:'600000000',email:'TEST@example.invalid',password:'Test secret 123'};
{
 const h=makeHarness();const r=await h.call({...valid,active:true,role:'Supervisor',photoUrl:'ignored'});
 assert.equal(r.code,201);assert.equal(h.writes[0].length,4);const w=h.writes[0][0].data;
 assert.equal(w.active,false);assert.equal(w.registrationStatus,'pending');assert.equal(w.role,'Operario');assert.equal(w.photoUrl,'');
 assert.equal(w.pin,'');assert.equal(w.pinHash,'hash:Test secret 123');assert.equal(r.body.worker.pinHash,'');
 assert.equal(w.email,'test@example.invalid');assert.equal(w.phone,'+34600000000');
 assert.ok(h.writes[0].slice(1).every(d=>/^worker_registration_keys\/[a-f0-9]{64}$/.test(d.path)));
 assert.ok(h.rates.every(args=>args.length===4));notes.push('alta pendiente, permisos no controlables por solicitante, normalizacion y hash');
}
for(const existing of ['phone','email','dni']){const h=makeHarness({existing});assert.equal((await h.call(valid)).code,409);assert.equal(h.writes.length,0);}
notes.push('duplicados de telefono, email, DNI');
for(const dni of ['12345678A','000','X1234567A']) assert.equal((await makeHarness().call({...valid,dni})).code,400);
for(const dni of ['12345678Z','X1234567L','Y1234567X','Z1234567R']) assert.equal((await makeHarness().call({...valid,dni})).code,201);
notes.push('checksum DNI/NIE X/Y/Z');
for(const password of ['short',' '.repeat(8),'x'.repeat(129),{bad:true}]) assert.equal((await makeHarness().call({...valid,password})).code,400);
notes.push('contrasenas invalidas');
{
 const h=makeHarness({limited:true});const r=await h.call(valid);assert.equal(r.code,429);assert.equal(r.headers['Retry-After'],'25');assert.equal(h.writes.length,0);
 const c=makeHarness({conflict:true});assert.equal((await c.call(valid)).code,409);assert.equal(c.telegram,0);
 assert.equal((await makeHarness({telegramError:true}).call(valid)).code,201);
}
notes.push('429, conflicto atomico y Telegram no bloqueante');
assert.equal((await makeHarness().call(valid,{},'GET')).code,405);
assert.equal((await makeHarness({authError:true}).call(valid,{authorization:'invalid'})).code,403);
const admin=makeHarness();assert.equal((await admin.call({...valid,active:true,role:'Supervisor'},{authorization:'admin-test'})).code,201);assert.equal(admin.writes[0][0].data.active,true);
assert.equal((await makeHarness({dbError:true}).call(valid)).code,500);
notes.push('metodo, autorizacion y fallo de base de datos');
const rateJS=strip(rateSource).replace(/export /g,'')+'; return InMemoryRateLimitService;';
const Limiter=Function(rateJS)();const limiter=new Limiter();
assert.equal(limiter.check('register','ip:test',1,1000).allowed,true);
assert.equal(limiter.check('register','ip:test',1,1000).allowed,false);
notes.push('limitador real: segundo intento bloqueado');
// Exercise the real atomic helper against an in-memory REST double. No network.
const atomicJS=strip(atomicSource).replace('export const createFirestoreDocumentsAtomically','const createFirestoreDocumentsAtomically')+'; return createFirestoreDocumentsAtomically;';
let saved=new Map(), calls=[];
const commitMock=async(url,req)=>{
 const payload=JSON.parse(req.body);calls.push({url,payload});
 if(payload.writes.some(w=>saved.has(w.update.name))) return {status:409,ok:false,json:async()=>({error:{status:'ALREADY_EXISTS'}})};
 payload.writes.forEach(w=>saved.set(w.update.name,w.update.fields));
 return {status:200,ok:true,json:async()=>({writeResults:[]})};
};
const atomic=Function('getGoogleAccessToken','firestoreBaseUrl','jsToFirestoreValue','fetch',atomicJS)(
 async()=>'test-token',()=> 'https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents',
 v=>typeof v==='boolean'?{booleanValue:v}:{stringValue:String(v)},commitMock);
const docs=id=>[{path:'workers/'+id,data:{id,active:false}},{path:'worker_registration_keys/shared',data:{workerId:id}}];
const results=await Promise.all([atomic(docs('A')),atomic(docs('B'))]);
assert.deepEqual(results,[true,false]);assert.equal(saved.size,2);
assert.ok(calls.every(c=>c.payload.writes.every(w=>w.currentDocument.exists===false)));
assert.equal(calls[0].url,'https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents:commit');
assert.ok(![...saved.keys()].some(k=>k.endsWith('/B')));
const failedAtomic=Function('getGoogleAccessToken','firestoreBaseUrl','jsToFirestoreValue','fetch',atomicJS)(
 async()=>'test',()=> 'https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents', v=>v,
 async()=>({status:403,ok:false,json:async()=>({error:{status:'PERMISSION_DENIED'}})}));
await assert.rejects(()=>failedAtomic(docs('C')));
notes.push('helper atomico real: concurrencia, sin escrituras parciales y errores');
console.log(JSON.stringify({passed:notes,networkRequests:0},null,2));
