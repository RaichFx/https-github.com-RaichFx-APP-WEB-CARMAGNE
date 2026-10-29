import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const compile = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '')
  .replace('export default async function handler', 'return async function handler');
const loginSource = read('api/auth/worker-login.ts');
const claimsLog = [];
const baseWorker = {
 id:'W-test',name:'Prueba',email:'test@example.invalid',active:false,registrationStatus:'pending',
 emailVerificationRequired:true,firebaseEmailRecovery:true,pin:'',pinHash:'hash',
};
const account = (verified = false) => ({
 localId:'W-test',email:'test@example.invalid',emailVerified:verified,providerUserInfo:[{providerId:'password'}],
});
function loginHarness(options = {}) {
 const issued = [], finalized = [];
 const worker = options.worker || structuredClone(baseWorker);
 const mocks = {
 createFirebaseCustomToken:(uid,claims)=>{issued.push({uid,claims});claimsLog.push(claims);return 'test-token';},
 hashSecret:()=> 'hashed', isSpanishPhone:()=>true,normalizeSpanishPhone:value=>value,
 queryFirestoreBySpanishPhone:async()=>options.missingWorker?[]:[{id:worker.id,data:worker}],
 setFirestoreDocument:async()=>{},
 verifySecret:()=>options.valid !== false,
 checkRateLimit:()=>({allowed:options.rateLimited!==true}),
 writeSecurityAudit:()=>{},emailRecoveryEnabled:()=>false,
 getEmailAuthAccount:async()=>options.account===undefined ? account(false) : options.account,
 hasEmailPassword:value=>!!value?.email && !!value.providerUserInfo?.some(item=>item.providerId==='password'),
 verifyEmailPassword:async()=>options.valid===false ? null : 'password-token',
 finalizeEmailRecoveryWorker:async id=>finalized.push(id),
 console:{error:()=>{},warn:()=>{}},
 };
 const handler=Function(...Object.keys(mocks),compile(loginSource))(...Object.values(mocks));
 return {issued,finalized,async call(){
 const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await handler({method:'POST',headers:{},socket:{remoteAddress:'test'},body:{phone:'+34600000000',password:'Test password'}},res);
 return res;
 }};
}
let h=loginHarness();let response=await h.call();
assert.equal(response.code,403);assert.equal(response.body.code,'EMAIL_VERIFICATION_REQUIRED');
assert.equal(response.body.email,'test@example.invalid');
assert.deepEqual(h.issued,[{uid:'W-test',claims:{registrationPending:true}}]);
assert.equal(h.finalized.length,0);
h=loginHarness({account:null});response=await h.call();
assert.equal(response.body.code,'EMAIL_VERIFICATION_REQUIRED');assert.deepEqual(h.issued[0].claims,{registrationPending:true});
h=loginHarness({account:account(true)});response=await h.call();
assert.equal(response.code,403);assert.equal(response.body.code,'ACCOUNT_UNAVAILABLE');assert.equal(h.issued.length,0);
h=loginHarness({worker:{...baseWorker,active:true,registrationStatus:'approved'},account:account(false)});
response=await h.call();assert.equal(response.body.code,'EMAIL_VERIFICATION_REQUIRED');
h=loginHarness({worker:{...baseWorker,active:true,registrationStatus:'approved'},account:account(true)});
response=await h.call();assert.equal(response.code,200);assert.deepEqual(h.issued[0].claims,{role:'worker',workerId:'W-test'});assert.deepEqual(h.finalized,['W-test']);
h=loginHarness({valid:false});assert.equal((await h.call()).code,401);assert.equal(h.issued.length,0);
h=loginHarness({account:{...account(),disabled:true}});assert.equal((await h.call()).code,401);assert.equal(h.issued.length,0);
h=loginHarness({worker:{...baseWorker,registrationStatus:'rejected'}});assert.equal((await h.call()).body.code,'ACCOUNT_UNAVAILABLE');assert.equal(h.issued.length,0);
h=loginHarness({account:{...account(true),email:'other@example.invalid'}});assert.equal((await h.call()).body.code,'EMAIL_MISMATCH');assert.equal(h.issued.length,0);
h=loginHarness({worker:{...baseWorker,active:true,registrationStatus:'approved',emailVerificationRequired:undefined,firebaseEmailRecovery:undefined},account:null});
assert.equal((await h.call()).code,200);assert.deepEqual(h.issued[0].claims,{role:'worker',workerId:'W-test'});
h=loginHarness({worker:{...baseWorker,active:false,registrationStatus:'approved'},account:account(false)});
assert.equal((await h.call()).body.code,'ACCOUNT_UNAVAILABLE');assert.equal(h.issued.length,0);
h=loginHarness({worker:{...baseWorker,active:true,registrationStatus:'pending',emailVerificationRequired:undefined,firebaseEmailRecovery:undefined},account:null});
assert.equal((await h.call()).code,200); // Preserve legacy behavior; audit hardening is separate.
h=loginHarness({rateLimited:true});assert.equal((await h.call()).code,429);assert.equal(h.issued.length,0);

// Execute the actual secondary-session helper with SDK doubles, never a Firebase project.
const serviceSource=read('services/registrationVerification.ts');
const serviceJs=compile(serviceSource).replace('export const RegistrationVerification','const RegistrationVerification')+';return RegistrationVerification;';
function verificationHarness(options = {}) {
 const primary={uid:'primary-session-must-stay-the-same'};
 const events=[];
 const user={uid:'W-test',email:options.linked?'test@example.invalid':null,emailVerified:!!options.verified,
   providerData:options.linked?[{providerId:'password'}]:[],reload:async()=>{events.push('reload');}};
 const secondary={currentUser:null,languageCode:''};
 const deps={
 getApps:()=>[],initializeApp:(config,name)=>{events.push(['app',name]);return {name};},
 getAuth:app=>{assert.equal(app.name,'carmagne-registration-verification');return secondary;},
 setPersistence:async(auth,persistence)=>{assert.equal(auth,secondary);assert.equal(persistence,'memory-only');events.push('memory');},
 inMemoryPersistence:'memory-only',signInWithCustomToken:async(auth,token)=>{assert.equal(auth,secondary);assert.equal(token,'limited');secondary.currentUser=user;events.push('signin-limited');return {user};},
 EmailAuthProvider:{credential:(email,password)=>({email,password})},
 linkWithCredential:async(target,credential)=>{assert.equal(target,user);if(options.linkError)throw {code:'auth/email-already-in-use'};user.email=credential.email;user.providerData=[{providerId:'password'}];events.push('link');},
 sendEmailVerification:async target=>{assert.equal(target,user);events.push('send');if(options.sendError)throw {code:'auth/quota-exceeded'};},
 signOut:async auth=>{assert.equal(auth,secondary);secondary.currentUser=null;events.push('close');},
 firebaseConfig:{projectId:'not-a-real-project'},
 };
 return {service:Function(...Object.keys(deps),serviceJs)(...Object.values(deps)),events,user,primary,secondary};
}
let session=verificationHarness();
await session.service.prepare('limited',' TEST@example.invalid ','Test password');
assert.equal(session.secondary.languageCode,'es');assert.ok(session.events.includes('link'));
assert.deepEqual(await session.service.send(),{alreadyVerified:false});
assert.equal(session.events.filter(event=>event==='send').length,1);
assert.equal(session.primary.uid,'primary-session-must-stay-the-same');
session.user.emailVerified=true;assert.equal(await session.service.isVerified(),true);
assert.deepEqual(await session.service.send(),{alreadyVerified:true});
assert.equal(session.events.filter(event=>event==='send').length,1);
await session.service.close();assert.equal(session.secondary.currentUser,null);
session=verificationHarness({linked:true,sendError:true});
await session.service.prepare('limited','test@example.invalid','Test password');
assert.ok(!session.events.includes('link'));
await assert.rejects(()=>session.service.send(),error=>error.code==='auth/quota-exceeded');
assert.equal(session.user.providerData[0].providerId,'password');
session=verificationHarness({linkError:true});
await assert.rejects(()=>session.service.prepare('limited','test@example.invalid','Test password'),error=>error.code==='auth/email-already-in-use');
assert.ok(!session.events.includes('send'));

const rules=read('firestore.rules');
const sites=rules.split('match /sites/{id}')[1].split('match /tools/')[0];
assert.ok(!sites.includes('allow read: if signedIn();'));
assert.ok(sites.includes("signedIn() && role() in ['admin', 'superadmin', 'worker', 'ADMIN', 'OWNER', 'WORKER', 'MANAGER', 'manager']"));
const registration=read('api/auth/register-worker.ts');
assert.match(registration,/emailVerificationRequired: true, firebaseEmailRecovery: true/);
assert.match(registration,/createFirebaseCustomToken\(workerId, \{ registrationPending: true \}\)/);
assert.ok(!registration.includes("createFirebaseCustomToken(workerId, { role: 'worker'"));
console.log(JSON.stringify({
 passed:['pending/unverified gets limited token only','verified still requires approval','approved still requires verification','approved+verified logs in','wrong password/disabled/rejected/mismatched email denied','legacy accounts unaffected','memory-only secondary auth leaves primary session unchanged','verification send and resend','quota/link errors preserved without claiming delivery','sites role guard prepared'],
 networkRequests:0,realEmails:0,productionWrites:0,
},null,2));
