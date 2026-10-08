import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
// Entire UI module graph is compiled, but authentication/network are unavailable.
test('offline component render: role navigation, report detail and modal contracts',async()=>{
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=()=>{network++;throw new Error('Network forbidden in component test');};
 const server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'offline-supabase',enforce:'pre',resolveId(id){if(id.endsWith('/supabaseClient.js')||id==='./supabaseClient.js')return '\0offline-supabase';},load(id){if(id==='\0offline-supabase')return 'export const supabase=null;';}}]});
 try {
  const {default:Workspace}=await server.ssrLoadModule('/src/views/InventoryV2.jsx');
  for(const role of ['admin','staff','purchasing']){
   const html=renderToStaticMarkup(React.createElement(Workspace,{role,profile:{id:'offline',full_name:'Test user'},api:{},signOut:()=>{}}));
   assert.ok(html.includes('Test user'));assert.ok(html.includes('inv-bottom'));
   const nav=html.slice(html.lastIndexOf('<nav'));assert.equal((nav.match(/<button/g)||[]).length,role==='admin'?4:2);
  }
  const {OrderChips}=await server.ssrLoadModule('/src/components/OrderChips.jsx');
  const chips=renderToStaticMarkup(React.createElement(OrderChips,{values:['SLP-01','SLP-02'],draft:'',reviewed:false,onChange:()=>{},onDraftChange:()=>{},onReviewedChange:()=>{}}));
  assert.ok(chips.includes('Remove SLP-01'));assert.ok(chips.includes('Remove SLP-02'));assert.ok(chips.includes('enterKeyHint="done"'));assert.ok(chips.includes('type="checkbox"'));assert.ok(!chips.includes('<textarea'));
  const {ReportTable}=await server.ssrLoadModule('/src/components/InventoryReports.jsx');
  const table=renderToStaticMarkup(React.createElement(ReportTable,{rows:[{model_name:'Historical model',required_qty:'0.25'}],columns:[['model_name','Model'],['required_qty','Requirement']]}));
  assert.ok(table.includes('Historical model'));assert.ok(table.includes('0.25'));
  const {InventoryManagementForm}=await server.ssrLoadModule('/src/components/InventoryManagementForm.jsx');
  const {ReceiptFields}=await server.ssrLoadModule('/src/components/InventoryManagementForm.jsx');
  for(const type of ['none','po','invoice','both']){
   const receipt=renderToStaticMarkup(React.createElement(ReceiptFields,{values:{quantity:'1',supplier_source:'Shop',document_type:type,po_number:'PO-123',invoice_number:'INV-456',note:''},change:()=>{}}));
   assert.equal(receipt.includes('value="PO-123"'),['po','both'].includes(type));
   assert.equal(receipt.includes('value="INV-456"'),['invoice','both'].includes(type));
   assert.ok(receipt.includes('Shop'));assert.ok(!receipt.includes('RCV-'));
   assert.ok(receipt.includes('ระบบจะออกเลขเมื่อบันทึก'));
  }

  const form=renderToStaticMarkup(React.createElement(InventoryManagementForm,{task:{kind:'save_model',category:'Universal'},api:{},role:'admin',catalog:{},onClose:()=>{},onSuccess:()=>{}}));
  assert.ok(form.includes('Universal'));assert.ok(form.includes('disabled'));
  const {InventoryExtensionForm}=await server.ssrLoadModule('/src/components/InventoryExtensionForm.jsx');
  const returned=renderToStaticMarkup(React.createElement(InventoryExtensionForm,{task:{kind:'close_not_completed',row:{model_name:'Historical',returnable_lines:[{line_id:'l',returnable_qty:'0.25'}],bom_snapshot:[{line_id:'l',material_name:'Snapshot',unit:'ml'}]}},role:'admin',api:{},onClose:()=>{},onSuccess:()=>{}}));
  assert.ok(returned.includes('Snapshot'));assert.ok(returned.includes('max="0.25"'));assert.ok(returned.includes('value="0.25"'));
  const denied=renderToStaticMarkup(React.createElement(InventoryExtensionForm,{task:{kind:'issue_finished',row:{request_id:'p'}},role:'purchasing',api:{}}));assert.ok(denied.includes('<fieldset disabled=""'));
  const config=renderToStaticMarkup(React.createElement(InventoryManagementForm,{task:{kind:'create_material'},api:{},role:'admin',catalog:{},onClose:()=>{},onSuccess:()=>{}}));
  assert.ok(config.includes('ต้องหยิบ/ยืนยันโดยหัวหน้า'));assert.ok(config.includes('ตัดใช้ตาม BOM อัตโนมัติ'));assert.ok(config.includes('ไม่แก้ BOM Snapshot'));
  const {InventoryWorkflowForm}=await server.ssrLoadModule('/src/components/InventoryWorkflowForm.jsx');
  const mk=(id,qty,auto=false)=>({id,order_ref:id,lines:[{line_id:id,material_id:auto?'auto':'manual',material_name:auto?'Automatic hidden':'Driver grouped',unit:'pcs',qty,requires_picking:!auto,picked:false}]});
  const pick=renderToStaticMarkup(React.createElement(InventoryWorkflowForm,{task:{kind:'pick',rows:[mk('one',2),mk('two',3),mk('auto',4,true)]},api:{},role:'admin',profile:{},onClose:()=>{},onSuccess:()=>{}}));
  assert.equal((pick.match(/type="checkbox"/g)||[]).length,1);assert.ok(pick.includes('Driver grouped'));assert.ok(pick.includes('5'));assert.ok(pick.includes('2'));assert.ok(pick.includes('one'));assert.ok(pick.includes('two'));assert.ok(!pick.includes('Automatic hidden'));

  for(const category of ['CIEM','Tactical','Lifestyle','Sleepplug','Universal']){
   const normal=renderToStaticMarkup(React.createElement(InventoryWorkflowForm,{task:{kind:'create',model:{id:'model',name:'Selected',category}},api:{},role:'staff',profile:{},onClose:()=>{},onSuccess:()=>{}}));
   assert.ok(normal.includes('Selected'));assert.ok(!normal.includes('<select'));assert.ok(normal.includes('aria-label="ปิด"'));
   assert.ok(!normal.includes('type="checkbox"'));assert.ok(!normal.includes('ซ่อมและอื่นๆ'));
   assert.equal(normal.includes('เพิ่มหลายออเดอร์พร้อมกัน'),category==='Sleepplug');
  }
  const repair=renderToStaticMarkup(React.createElement(InventoryWorkflowForm,{task:{kind:'create',repair:true},api:{},role:'staff',profile:{},onClose:()=>{},onSuccess:()=>{}}));
  assert.ok(repair.includes('ซ่อมและอื่นๆ'));assert.ok(repair.includes('เพิ่มวัตถุดิบ'));assert.ok(!repair.includes('เพิ่มหลายออเดอร์พร้อมกัน'));
  const {RequestsPanel,SupervisorRequests}=await server.ssrLoadModule('/src/components/InventoryWorkspacePanels.jsx');
  const staffPage=renderToStaticMarkup(React.createElement(RequestsPanel,{api:{},role:'staff',userId:'s',onAction:()=>{}}));
  assert.ok(staffPage.includes('งานที่ยังไม่เสร็จ'));assert.ok(staffPage.includes('ประวัติคำขอ'));assert.ok(!staffPage.includes('<select'));assert.ok(!staffPage.includes('type="date"'));
  const supervisor=renderToStaticMarkup(React.createElement(SupervisorRequests,{api:{},role:'admin',userId:'a',onAction:()=>{}}));
  assert.ok(supervisor.includes('คิวหยิบ'));assert.ok(supervisor.includes('คำขอทั้งหมด'));
  const {ModalHeader,BomEditor,Overflow}=await server.ssrLoadModule('/src/components/InventoryUI.jsx');
  const close=renderToStaticMarkup(React.createElement(ModalHeader,{title:'Edit',busy:true,onClose:()=>{}}));
  assert.ok(close.includes('aria-label="ปิด"'));assert.ok(close.includes('disabled'));
  const bom=renderToStaticMarkup(React.createElement(BomEditor,{materials:[{id:'m',name:'Resin',unit:'ml',is_active:true}],rows:[{material_id:'m',qty:'0.25'}],onChange:()=>{}}));
  assert.equal((bom.match(/<select/g)||[]).length,1);assert.ok(bom.includes('value="0.25"'));assert.ok(bom.includes('นำ Resin ออกจาก BOM'));assert.ok(!bom.includes('เพิ่มบรรทัด'));
  const overflow=renderToStaticMarkup(React.createElement(Overflow,{label:'จัดการ'},React.createElement('button',null,'แก้ไข')));
  assert.ok(overflow.includes('<details'));assert.ok(!overflow.includes(' open'));assert.ok(overflow.includes('aria-label="จัดการ"'));
  const generic=renderToStaticMarkup(React.createElement(InventoryWorkflowForm,{task:{kind:'create'},api:{},role:'staff',profile:{},onClose:()=>{},onSuccess:()=>{}}));assert.ok(generic.includes('<select'));
  assert.equal(network,0);
 }finally{await server.close();globalThis.fetch=originalFetch;}
});
