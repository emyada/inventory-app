import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

for(const enabled of ['true','false']) test(`App auth boundary and feature routing, V2=${enabled} (offline)`,async()=>{
 const server=await createServer({configFile:false,envDir:false,resolve:{preserveSymlinks:true},ssr:{external:['react','react-dom','lucide-react']},
  define:{'import.meta.env.VITE_INVENTORY_V2_ENABLED':JSON.stringify(enabled)},server:{middlewareMode:true,hmr:false,watch:null},
  plugins:[{name:'offline-app-boundaries',enforce:'pre',resolveId(id){
   if(id.includes('context/AuthContext'))return '\0test-auth';
   if(id.includes('hooks/useInventoryData'))return '\0test-inventory';
   if(id.endsWith('supabaseClient')||id.endsWith('supabaseClient.js'))return '\0test-client';
  },load(id){
   if(id==='\0test-auth')return 'let state; export function setAuth(value){state=value;} export function useAuth(){return state;}';
   if(id==='\0test-inventory')return 'export function useInventoryData(){return {loading:true};}';
   if(id==='\0test-client')return 'export const supabase=null;';
  }}]});
 try{
  const {default:App}=await server.ssrLoadModule('/src/App.jsx');
  const {setAuth}=await server.ssrLoadModule('\0test-auth');
  const session={user:{id:'admin'}},profile={id:'admin',username:'test-admin',enabled:true,role:'admin'};
  const render=patch=>{setAuth({session,profile,role:'admin',loading:false,error:null,signOut:()=>assert.fail('Render must not sign out'),...patch});return renderToStaticMarkup(React.createElement(App));};
  const restoring=render({loading:true,session:null,profile:null});
  assert.match(restoring,/กำลังตรวจสอบการเข้าสู่ระบบ/);assert.doesNotMatch(restoring,/type="password"/);
  assert.match(render({session:null,profile:null}),/type="password"/);
  const failed=render({error:'Permission lookup failed'});assert.match(failed,/role="alert"/);assert.match(failed,/ลองใหม่/);assert.doesNotMatch(failed,/กำลังโหลดข้อมูลสต๊อก|inv-bottom/);
  const disabled=render({profile:{...profile,enabled:false}});assert.match(disabled,/บัญชีถูกระงับ/);assert.match(disabled,/ออกจากระบบ/);assert.doesNotMatch(disabled,/inv-bottom|กำลังโหลดข้อมูลสต๊อก/);
  if(enabled==='true'){
   for(const missing of [null,{...profile,id:'another-user'}]){const html=render({profile:missing});assert.match(html,/กำลังโหลดสิทธิ์ผู้ใช้/);assert.doesNotMatch(html,/type="password"|inv-bottom/);}
   assert.match(render({}),/กำลังโหลด Inventory V2/);
  }else{assert.match(render({}),/กำลังโหลดข้อมูลสต๊อก/);assert.doesNotMatch(render({}),/กำลังโหลด Inventory V2/);}
 }finally{await server.close();}
});
