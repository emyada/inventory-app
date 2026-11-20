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

test('TagField shows the channel badge when the tag matches and asks to tick อื่นๆ when it does not',async()=>{
 const server=await createServer({configFile:false,envDir:false,ssr:{external:['react','react-dom']},server:{middlewareMode:true,hmr:false,watch:null}});
 try{
  const {TagField,ChannelBadge}=await server.ssrLoadModule('/src/components/store/shared.jsx');
  const channels=[{code:'tiktok',name:'TikTok',color:'red',active:true,pattern:'^[0-9]{18}$'},{code:'other',name:'อื่นๆ',color:'amber',active:true,is_system:true,pattern:null}];
  const render=(tag,other)=>renderToStaticMarkup(React.createElement(TagField,{channels,tag,onTag(){},other,onOther(){},required:true}));
  const ok=render('587229145958089832',false);
  assert.ok(ok.includes('store-channel-red')&&ok.includes('TikTok')&&!ok.includes('ไม่ตรงกับช่องทางที่มีอยู่')&&!ok.includes('type="checkbox"'));
  const bad=render('ABC-99',false);
  assert.ok(bad.includes('ไม่ตรงกับช่องทางที่มีอยู่ ติ๊กอื่นๆ เพื่อทำรายการ')&&bad.includes('type="checkbox"')&&!bad.includes('store-channel-red'));
  const tick=render('ABC-99',true);
  assert.ok(tick.includes('store-channel-amber')&&!tick.includes('ไม่ตรงกับช่องทางที่มีอยู่'));
  assert.ok(!render('',false).includes('store-channel '));
  assert.equal(renderToStaticMarkup(React.createElement(ChannelBadge,{name:''})),'');
 }finally{await server.close();}
});
