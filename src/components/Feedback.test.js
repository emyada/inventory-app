import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

test('FeedbackButton renders for every role and feedbackContext is compact',async()=>{
 const server=await createServer({configFile:false,envDir:false,ssr:{external:['react','react-dom']},server:{middlewareMode:true,hmr:false,watch:null}});
 try{
  const mod=await server.ssrLoadModule('/src/components/Feedback.jsx');
  const api=new Proxy({},{get:()=>()=>new Promise(()=>{})});
  for(const role of ['admin','staff','store','purchasing']){
   const html=renderToStaticMarkup(React.createElement(mod.FeedbackButton,{api,role,page:'store',revision:0,disabled:false}));
   assert.ok(html.includes('แจ้งปัญหา / เสนอแนะ'),role);
  }
  const ctx=mod.feedbackContext({navigator:{userAgent:'x'.repeat(500)},innerWidth:390,innerHeight:800,matchMedia:()=>({matches:true})});
  assert.equal(ctx.ua.length,200);assert.equal(ctx.screen,'390x800');assert.equal(ctx.standalone,true);
  assert.deepEqual(Object.keys(mod.FEEDBACK_CATEGORIES),['problem','idea','question']);
 }finally{await server.close();}
});
