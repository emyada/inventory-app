import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

test('compact request references include every category without collapsed action cards or network',async()=>{
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=()=>{network++;throw new Error('Network forbidden');};
 const server=await createServer({configFile:false,envDir:false,ssr:{external:['react','react-dom','lucide-react']},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'offline-supabase',enforce:'pre',resolveId(id){if(id.endsWith('/supabaseClient.js')||id==='./supabaseClient.js')return '\0offline-supabase';},load(id){if(id==='\0offline-supabase')return 'export const supabase=null;';}}]});
 try{
  const {CompactRequestList}=await server.ssrLoadModule('/src/components/InventoryWorkspacePanels.jsx');
  const rows=['CIEM','Tactical','Lifestyle','Sleepplug','Universal','ซ่อมและอื่นๆ'].map((category,i)=>({id:`req-${i}`,order_ref:`Z${i}`,model_name:`Model ${i}`,category,workflow_state:'pending',staff_name:'Submitter'}));
  const html=renderToStaticMarkup(React.createElement(CompactRequestList,{rows,role:'admin'}));
  assert.equal((html.match(/aria-expanded="false"/g)||[]).length,6);assert.ok(html.includes('ทุกหมวดสินค้า'));
  for(const row of rows)assert.ok(html.includes(`${row.order_ref} · ${row.model_name} · ${row.category}`));
  assert.ok(!html.includes('inv-card'));assert.ok(!html.includes('ยกเลิกคำขอ'));assert.ok(!html.includes('<article'));
  const queue=renderToStaticMarkup(React.createElement(CompactRequestList,{rows,queue:true,role:'admin'}));
  assert.ok(queue.includes('ยังไม่ระบุช่าง'));assert.ok(!queue.includes('Submitter'));assert.equal(network,0);
 }finally{await server.close();globalThis.fetch=originalFetch;}
});
