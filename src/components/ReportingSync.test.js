import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
test('sync visibility and mapping gate use existing Admin boundary',async()=>{
 const server=await createServer({configFile:false,envDir:false,resolve:{preserveSymlinks:true},ssr:{external:['react','react-dom']},server:{middlewareMode:true,hmr:false,watch:null}});
 try{
  const {ReportingSync}=await server.ssrLoadModule('/src/components/ReportingSync.jsx');
  const render=(role,status,report={})=>renderToStaticMarkup(React.createElement(ReportingSync,{role,configured:true,state:{status,report}}));
  assert.equal(renderToStaticMarkup(React.createElement(ReportingSync,{role:'admin',state:{status:'ready',report:{mapping_revision:'reviewed'}}})), '');
  assert.equal(render('staff','ready'),'');assert.equal(render('purchasing','ready'),'');
  for(const status of ['mapping','loading','error','idle','ready'])assert.match(render('admin',status),/disabled/);
  assert.doesNotMatch(render('admin','ready',{mapping_revision:'reviewed'}),/disabled/);
 }finally{await server.close();}
});
