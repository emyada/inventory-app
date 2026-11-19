import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

// Smoke test: the split store modules load together and the shell renders per role.
test('StoreWorkspace renders tabs per role and re-exports its parts',async()=>{
 const server=await createServer({configFile:false,envDir:false,ssr:{external:['react','react-dom']},server:{middlewareMode:true,hmr:false,watch:null}});
 try{
  const mod=await server.ssrLoadModule('/src/components/StoreWorkspace.jsx');
  for(const name of ['StoreWorkspace','StoreSell','StoreStock','StoreSales','StoreReports','StoreTransferForm','StoreTransferHistory'])assert.equal(typeof mod[name],'function',name);
  const api=new Proxy({},{get:()=>()=>new Promise(()=>{})});
  const admin=renderToStaticMarkup(React.createElement(mod.StoreWorkspace,{api,role:'admin',userId:'u',revision:0,onChanged(){},actionBusy:false}));
  assert.ok(admin.includes('ยอดหน้าร้าน')&&admin.includes('รายการขาย'));
  const store=renderToStaticMarkup(React.createElement(mod.StoreWorkspace,{api,role:'store',userId:'u',revision:0,onChanged(){},actionBusy:false}));
  assert.ok(admin.includes('อื่นๆ')&&admin.includes('รายงาน'));
  assert.ok(store.includes('ขาย')&&store.includes('ยอดหน้าร้าน')&&store.includes('รายการขาย'));
  assert.ok(!store.includes('อื่นๆ')&&!store.includes('>รายงาน<'));
  assert.ok(store.includes('store-sell-side')&&!store.includes('store-recent'),'phone/SSR: wrapper only, no recent-sales panel');
  const order=['>ขาย<','>ยอดหน้าร้าน<','>รายการขาย<'].map(t=>store.indexOf(t));
  assert.ok(order.every(i=>i>=0)&&order[0]<order[1]&&order[1]<order[2],'store tab order: ขาย, ยอดหน้าร้าน, รายการขาย');
 }finally{await server.close();}
});
