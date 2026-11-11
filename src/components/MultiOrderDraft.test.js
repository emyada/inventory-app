import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
test('multi-model draft renders distinct required fields and review acknowledgment',async()=>{
 const server=await createServer({configFile:false,envDir:false,ssr:{external:['react','react-dom']},server:{middlewareMode:true,hmr:false,watch:null}});
 try {
 const {MultiOrderDraft}=await server.ssrLoadModule('/src/components/MultiOrderDraft.jsx');
 const html=renderToStaticMarkup(React.createElement(MultiOrderDraft,{rows:[{model_id:'a',order_ref:'001'},{model_id:'b',order_ref:'002'}],models:[{id:'a',name:'One',category:'CIEM'},{id:'b',name:'Two',category:'Sleepplug'}],reviewed:false,onChange(){},onReviewedChange(){}}));
 assert.equal((html.match(/<select/g)||[]).length,2);
 assert.ok(html.includes('001')&&html.includes('002'));
 assert.ok(html.includes('CIEM')&&html.includes('Sleepplug'));
 assert.ok(html.includes('type="checkbox" required=""'));
 assert.ok(!html.includes('type="number"'));
 } finally {await server.close();}
});
