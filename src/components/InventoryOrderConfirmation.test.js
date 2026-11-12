import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
test('Admin order picker renders loading/disabled submit; other roles denied without reads (offline SSR)',async()=>{
 const server=await createServer({configFile:false,envDir:false,ssr:{external:['react','react-dom']},server:{middlewareMode:true,hmr:false,watch:null}});
 try{const {InventoryOrderConfirmation}=await server.ssrLoadModule('/src/components/InventoryOrderConfirmation.jsx');
 const props={task:{rows:[{id:'o',order_ref:'Z1',model_name:'Model'}]},api:{list_materials:()=>assert.fail('SSR must not read')},onClose(){},onSuccess(){}};
 const html=renderToStaticMarkup(React.createElement(InventoryOrderConfirmation,{...props,role:'admin'}));
 assert.match(html,/Z1/);assert.match(html,/เลือกหนึ่งออเดอร์/);assert.match(html,/<button disabled="">ยืนยันทั้งออเดอร์/);
 for(const role of ['staff','purchasing']){const denied=renderToStaticMarkup(React.createElement(InventoryOrderConfirmation,{...props,role}));assert.match(denied,/เฉพาะ Admin/);assert.doesNotMatch(denied,/<select/);}
 }finally{await server.close();}
});
