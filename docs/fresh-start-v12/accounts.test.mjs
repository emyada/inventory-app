import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {accountEndpoint} from '../../api/stock-accounts.js';
import {loginAlias} from '../../src/lib/loginAlias.js';

const ref='abcdefghijklmnopqrst';
const cfg={STOCK_ACCOUNT_MUTATIONS_ENABLED:'true',STOCK_ACCOUNT_PROJECT_REF:ref,VITE_SUPABASE_EXPECTED_PROJECT_REF:ref,VITE_SUPABASE_URL:'https://'+ref+'.supabase.co',VITE_SUPABASE_ANON_KEY:'mock-public',STOCK_ACCOUNT_SECRET:'mock-private'};
const id='00000000-0000-4000-8000-000000000001';
for (const flag of [undefined, 'false', '', 'TRUE', true]) {
  test('server read-only rejects every mutation without connecting: '+String(flag),async()=>{
    for (const action of ['create','edit','update','disable','enable','reset','unknown',undefined]) {
      let connections=0;
      const res={setHeader(){},status(code){this.code=code;return this;},json(value){this.value=value;}};
      await accountEndpoint({...cfg,STOCK_ACCOUNT_MUTATIONS_ENABLED:flag,VITE_INVENTORY_MUTATIONS_ENABLED:'true'},()=>{connections++;throw Error('must not connect');})({method:'POST',headers:{authorization:'Bearer mock'},body:{action,STOCK_ACCOUNT_MUTATIONS_ENABLED:'true'}},res);
      assert.equal(res.code,403);assert.match(res.value.error,/READ ONLY/);assert.equal(connections,0);
    }
  });
}
async function request({role='admin',enabled=true,body,env=cfg,token=true,deny=false,createError=null,authError=false}) {
  const calls=[];
  const connect=(_url,key)=>{
    if(key===cfg.VITE_SUPABASE_ANON_KEY) return {
      auth:{getUser:async()=>({data:{user:authError?null:{id}},error:authError})},
      from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role,enabled}})}),order:async()=>({data:[{id,role,enabled}]})})})
    };
    calls.push('privileged');
    return {rpc:async(_name,args)=>{calls.push(args);return {error:deny};},auth:{admin:{
      createUser:async args=>{calls.push(args);return {error:createError};},
      updateUserById:async()=>{calls.push('reset');return {};}
    }}};
  };
  const res={setHeader(){},status(code){this.code=code;return this;},json(value){this.value=value;}};
  await accountEndpoint(env,connect)({method:'POST',headers:token?{authorization:'Bearer mock'}:{},body},res);
  return {res,calls};
}
test('case-insensitive alias without email or whitespace injection',()=>{
  assert.equal(loginAlias('  Test.A '),'test.a@iem-workshop.local');
  for(const input of ['x@y','a b','',null,'../a']) assert.equal(loginAlias(input),null);
});
for(const [label,options,code] of [['Staff',{role:'staff'},403],['Purchasing',{role:'purchasing'},403],['disabled Admin',{enabled:false},403],['anonymous',{token:false},401],['unconfigured',{env:{STOCK_ACCOUNT_MUTATIONS_ENABLED:'true'}},503]]) test(label+' cannot manage users',async()=>{
  const {res,calls}=await request({...options,body:{action:'disable',id}});assert.equal(res.code,code);assert.deepEqual(calls,[]);
});
test('create derives actor and managed alias on server',async()=>{
  const {res,calls}=await request({body:{action:'create',username:'Ab',name:'Test',role:'staff',password:'sample-test-only',actor:'forged'}});
  assert.equal(res.code,200);assert.equal(calls[1].app_metadata.stock_actor,id);assert.equal(calls[1].email,'ab@iem-workshop.local');assert.deepEqual(res.value,{ok:true});
});
test('eight numeric characters accepted; no password in metadata or response',async()=>{
 const {res,calls}=await request({body:{action:'create',username:'  NOON ',name:'Noon',role:'staff',password:'12345678'}});
 assert.equal(res.code,200);assert.equal(calls[1].email,loginAlias('noon'));assert.equal(calls[1].email_confirm,true);
 assert.equal(calls[1].password,'12345678');assert.equal(calls[1].app_metadata.stock_role,'staff');
 assert.ok(!JSON.stringify(calls[1].app_metadata).includes('12345678'));assert.ok(!JSON.stringify(res.value).includes('12345678'));
});
test('password boundaries enforced on create and reset',async()=>{
 for(const action of ['create','reset'])for(const password of ['1234567','x'.repeat(129),12345678,null]){
 const {res,calls}=await request({body:{action,id,username:'noon',name:'Noon',role:'staff',password}});
 assert.equal(res.code,400);assert.deepEqual(calls,[]);
 }
});
test('staff cannot create Admin even with forged actor/role',async()=>{
 const {res,calls}=await request({role:'staff',body:{action:'create',username:'noon',name:'Noon',role:'admin',actor:id,password:'12345678'}});
 assert.equal(res.code,403);assert.deepEqual(calls,[]);
});
test('invalid session rejected before privileged connection',async()=>{
 const {res,calls}=await request({authError:true,body:{action:'create'}});assert.equal(res.code,401);assert.deepEqual(calls,[]);
});
test('duplicate username rejected without exposing Auth error details',async()=>{
 const {res}=await request({createError:{code:'email_exists',message:'private diagnostics'},body:{action:'create',username:'Noon',name:'Noon',role:'staff',password:'12345678'}});
 assert.equal(res.code,409);assert.match(res.value.error,/มีอยู่แล้ว/);assert.ok(!JSON.stringify(res.value).includes('private diagnostics'));
});
test('profile trigger failure reported, never falsely returns success',async()=>{
 const {res,calls}=await request({createError:{code:'unexpected_failure',message:'trigger failure'},body:{action:'create',username:'noon',name:'Noon',role:'staff',password:'12345678'}});
 assert.equal(res.code,409);assert.equal(calls.length,2);assert.ok(!res.value.ok);
});
test('Admin can list without secret; mutations remain unavailable',async()=>{
 const env={...cfg,STOCK_ACCOUNT_SECRET:undefined};
 const list=await request({env,body:{action:'list'}});assert.equal(list.res.code,200);assert.deepEqual(list.calls,[]);
 const write=await request({env,body:{action:'create'}});assert.equal(write.res.code,503);assert.deepEqual(write.calls,[]);
});
test('UI password boundary and duplicate-submit guard preserved',()=>{
 const ui=readFileSync(new URL('../../src/components/ManagedAccounts.jsx',import.meta.url),'utf8');
 assert.ok(ui.includes('minLength={8}'));assert.ok(ui.includes('if(inFlight.current)return;'));
 assert.ok(ui.includes("form.elements.password.value='';"));
});
test('role and password validation precede privileged call',async()=>{
  for(const body of [{action:'edit',id,name:'Test',role:'owner'},{action:'reset',id,password:'short'}]){
    const {res,calls}=await request({body});assert.equal(res.code,400);assert.deepEqual(calls,[]);
  }
});
test('denied reset never changes Auth password',async()=>{
  const {calls,res}=await request({deny:true,body:{action:'reset',id,password:'sample-test-only'}});
  assert.equal(res.code,409);assert.equal(calls.length,2);assert.equal(calls[1].p_action,'authorize_reset');assert.ok(!('password' in calls[1]));
});
test('fresh contract binds stock identity, serializes last admin guard and restricts Auth administration',()=>{
 const sql=readFileSync(new URL('./FRESH_INSTALL.review.sql',import.meta.url),'utf8');
 for(const needle of ['SELECT id FROM public.profiles WHERE id=auth.uid() AND enabled','LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE','Last active Admin','AFTER INSERT ON auth.users','stock_access_token_hook(jsonb) TO supabase_auth_admin','stock_manage_profile(uuid,uuid,text,text,text) TO service_role']) assert.ok(sql.includes(needle),needle);
});

