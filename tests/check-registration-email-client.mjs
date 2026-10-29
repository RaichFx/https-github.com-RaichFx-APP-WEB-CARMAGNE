import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const start=app.indexOf('  const registrationVerificationError =');
const end=app.indexOf('  const handleSaveForceEmail =', start);
assert.ok(start>=0 && end>start);
const actions=stripTypeScriptTypes(app.slice(start,end),{mode:'transform'})+';return {handleRegistration};';
async function scenario(sendFails) {
 const events=[],states={};
 const setter=name=>value=>{states[name]=value;};
 const refs={registrationInFlight:{current:false},verificationInFlight:{current:false}};
 const deps={
 ...refs,loading:false,regPhone:'+34600000000',regName:'Usuario de prueba',regDni:'12345678Z',regEmail:' TEST@example.invalid ',regPin:'Test password 123',regPinConfirm:'Test password 123',
 processSpanishPhone:value=>value,isPhoneValidSpain:()=>true,
 Step:{REGISTRATION_VERIFICATION:101,LOGIN_PHONE:0},
 RegistrationVerification:{
 prepare:async(token,email,password)=>{assert.equal(token,'limited');assert.equal(email,'test@example.invalid');assert.equal(password,'Test password 123');events.push('prepare');},
 send:async()=>{events.push('send');if(sendFails)throw {code:'auth/quota-exceeded'};return {alreadyVerified:false};},
 },
 fetch:async(url,options)=>{assert.equal(url,'/api/auth/register-worker');assert.ok(!options.headers.Authorization);events.push('registered');return {ok:true,json:async()=>({verificationToken:'limited',verificationRequired:true})};},
 };
 for(const name of ['VerificationRequest','VerificationReady','VerificationSent','RegistrationEmailVerified','VerificationError','VerificationPassword','Error','CurrentStep','VerificationBusy','VerificationNextSendAt','Loading','RegName','RegDni','RegEmail','RegPin','RegPinConfirm','LoginPassword','IsPhoneVerified']) deps['set'+name]=setter(name);
 const handler=Function(...Object.keys(deps),actions)(...Object.values(deps));
 await handler.handleRegistration();
 assert.deepEqual(events,['registered','prepare','send']);
 assert.equal(states.CurrentStep,101);assert.equal(states.RegPin,'');assert.equal(states.RegPinConfirm,'');
 assert.equal(states.Loading,false);assert.equal(refs.registrationInFlight.current,false);assert.equal(refs.verificationInFlight.current,false);
 if(sendFails) {
   assert.match(states.VerificationError,/solicitud está guardada/);
   assert.equal(states.Error,'');
 } else { assert.equal(states.VerificationSent,true);assert.equal(states.VerificationError,''); }
}
await scenario(false);await scenario(true);
console.log('PASS: el registro solicita el correo automáticamente y un fallo de envío no se presenta como fallo de registro; 0 correos reales.');
