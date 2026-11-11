import {test} from 'node:test';import assert from 'node:assert/strict';import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{createServer}from'vite';import{readFileSync}from'node:fs';
test('BOM history is wired into model management and hidden from non-Admin',async()=>{
 const server=await createServer({configFile:false,envDir:false,ssr:{external:['react','react-dom']},server:{middlewareMode:true,hmr:false,watch:null}});
 try{const {BomHistory}=await server.ssrLoadModule('/src/components/BomHistory.jsx');
 for(const role of ['staff','purchasing'])assert.equal(renderToStaticMarkup(React.createElement(BomHistory,{role})), '');
 assert.ok(renderToStaticMarkup(React.createElement(BomHistory,{role:'admin'})).includes('ดูประวัติแก้ BOM'));
 const form=readFileSync('src/components/InventoryManagementForm.jsx','utf8');assert.ok(form.includes('<BomHistory api={api}'));assert.ok(form.includes('api.bom_history'));assert.ok(form.includes('expected_bom:b'));
 }finally{await server.close();}
});
