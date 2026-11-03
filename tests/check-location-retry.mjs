import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const extract = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
const source = extract('  const getRequiredLocationErrorMessage =', '  const sanitizeWorkerForDirectory =') +
  extract('  const executeLogSubmission =', '  const resetApp =');
const js = stripTypeScriptTypes(source, {mode:'transform'}) + '; return {executeLogSubmission,handleLocationRetry};';
async function scenario(code) {
  let saved=[],state={},attempts=0,release;
  let phase='deny';
  const inFlight={current:false};
  const deps={
    locationSubmissionInFlight:inFlight,selectedWorker:{id:'Wtest',name:'Test'},loading:false,
    locationRetry:{type:'SALIDA',report:'Trabajo de prueba',mode:'HORAS'},
    setLoading:v=>state.loading=v,setError:v=>state.error=v,setLocationRetry:v=>state.retry=v,
    setConfirmState:()=>{},setExitReportText:()=>{},setCurrentStep:v=>state.step=v,
    LocationService:{getCurrentPosition:()=>{attempts++;if(phase==='deny')return Promise.reject({code});
      if(phase==='invalid')return Promise.resolve({latitude:NaN,longitude:0});
      return new Promise(resolve=>release=()=>resolve({latitude:40,longitude:-3,accuracy:10}));}},
    selectedSite:{id:'S',name:'Site'},sites:[],workerStatus:null,MAX_DISTANCE_METERS:100,
    StorageService:{addLog:async log=>saved.push(log)},
    PushService:{sendEvent:async()=>({ok:true})},TelegramService:{enviarEventoTelegram:async()=>true},
    Step:{SUCCESS:99},console:{warn(){},error(){}}
  };
  const actions=Function(...Object.keys(deps),js)(...Object.values(deps));
  await actions.handleLocationRetry();
  assert.equal(attempts,1);assert.equal(saved.length,0);assert.equal(inFlight.current,false);
  assert.equal(state.retry.report,'Trabajo de prueba');assert.ok(state.error);
  phase='invalid';await actions.handleLocationRetry();assert.equal(saved.length,0);assert.equal(inFlight.current,false);
  phase='allow';const first=actions.handleLocationRetry();await actions.handleLocationRetry();
  assert.equal(attempts,3);release();await first;
  assert.equal(saved.length,1);assert.equal(saved[0].type,'SALIDA');assert.equal(saved[0].workReport,'Trabajo de prueba');
  assert.equal(saved[0].workMode,'HORAS');assert.equal(state.step,99);assert.equal(inFlight.current,false);
}
for(const code of [1,2,3]) await scenario(code);
assert.ok(!app.includes('const getLocationPermissionState ='));
assert.ok(app.includes('Cómo activar el permiso'));
console.log('PASS: denied/unavailable/timeout never save, retry requests again, invalid coordinates blocked, double click ignored, report/mode preserved, one confirmed write.');
