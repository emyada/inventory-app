import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {employeeMayCreate} from '../lib/inventoryRequestPolicy.js';

// SSR does not run useEffect. Substitute only the read hook's resolved data;
// render the real component bodies, permission conditions and buttons unchanged.
const rows=[{id:'material',name:'Test material',unit:'pcs',qty:10,low_stock_threshold:2,is_active:true,
 order_ref:'existing',lines:[{line_id:'line',material_id:'material',material_name:'Test material',unit:'pcs',qty:1,requires_picking:true,picked:false}]}];
test('populated Receiving and existing picking stay enabled with Staff requests OFF',async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Live network forbidden');};
 const server=await createServer({configFile:false,envDir:false,resolve:{preserveSymlinks:true},ssr:{external:['react','react-dom','lucide-react']},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{
  name:'offline-populated-panels',enforce:'pre',
  resolveId(id){if(id.endsWith('/supabaseClient.js')||id==='./supabaseClient.js')return '\0offline-supabase';},
  load(id){if(id==='\0offline-supabase')return 'export const supabase=null;';},
  transform(code,id){if(!id.replaceAll('\\','/').endsWith('/src/components/InventoryWorkspacePanels.jsx'))return;
   const start=code.indexOf('function useRead('),end=code.indexOf('function ReadState(');
   assert.ok(start>=0&&end>start);
   return code.slice(0,start)+`function useRead(){return {busy:false,error:null,rows:${JSON.stringify(rows)}};}\n`+code.slice(end);
  },
 }]});
 try{
  const {MaterialsPanel,RequestsPanel}=await server.ssrLoadModule('/src/components/InventoryWorkspacePanels.jsx');
  const policy={employee_requests_enabled:false};
  const button=(html,label)=>{const matches=[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];const found=matches.find(m=>m[2].includes(label));assert.ok(found,`Missing ${label}`);return found[1];};
  for(const role of ['admin','purchasing']){
   const props={api:{},role,actionBusy:false,createBlocked:true,onAction:()=>{}};
   const html=renderToStaticMarkup(React.createElement(MaterialsPanel,props));
   assert.ok(html.includes('Test material'));assert.ok(html.includes('10'));
   assert.equal(html.includes('Bulk Receiving'),role==='admin');
   assert.doesNotMatch(button(html,'รับเข้า'),/disabled/);
   const busy=renderToStaticMarkup(React.createElement(MaterialsPanel,{...props,actionBusy:true}));
   assert.match(button(busy,'รับเข้า'),/disabled/);
  }
  const adminProps={api:{},role:'admin',userId:'admin',actionBusy:false,createBlocked:!employeeMayCreate('admin',policy),onAction:()=>{}};
  const admin=renderToStaticMarkup(React.createElement(RequestsPanel,adminProps));
  assert.doesNotMatch(button(admin,'ยื่นคำขอเบิก'),/disabled/);
  const staff=renderToStaticMarkup(React.createElement(RequestsPanel,{...adminProps,role:'staff',createBlocked:!employeeMayCreate('staff',policy)}));
  assert.match(button(staff,'ยื่นคำขอเบิก'),/disabled/);
  const queue=renderToStaticMarkup(React.createElement(RequestsPanel,{...adminProps,queue:true,createBlocked:true}));
  assert.doesNotMatch(button(queue,'เลือกรอบหยิบ'),/disabled/);
 }finally{await server.close();globalThis.fetch=originalFetch;}
});
