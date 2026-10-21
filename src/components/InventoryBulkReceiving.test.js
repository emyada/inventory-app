import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
test('bulk form renders optional shared fields; non-admin has no receiving form',async()=>{
 const server=await createServer({configFile:false,envDir:false,ssr:{external:['react','react-dom','lucide-react']},server:{middlewareMode:true,hmr:false,watch:null}});
 try{
  const {InventoryBulkReceiving}=await server.ssrLoadModule('/src/components/InventoryBulkReceiving.jsx');
  const render=role=>renderToStaticMarkup(React.createElement(InventoryBulkReceiving,{api:{},role,onClose:()=>{},onSuccess:()=>{}}));
  const html=render('admin');
  for(const text of ['Bulk Receiving','ค้นหาวัตถุดิบ','ผู้ขาย','ประเภทเอกสาร','วันที่เอกสาร','หมายเหตุ','ตรวจสอบก่อนบันทึก'])assert.ok(html.includes(text),text);
  for(const role of ['staff','purchasing']){assert.ok(render(role).includes('เฉพาะ Admin'));assert.ok(!render(role).includes('<form'));}
 }finally{await server.close();}
});
