import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { bootstrapInventory, inventoryEnvironment } from './lib/inventoryEnvironment.js'

const root=createRoot(document.getElementById('root'));
bootstrapInventory(inventoryEnvironment,{
  load:async()=>{const [app,auth]=await Promise.all([import('./App.jsx'),import('./context/AuthContext')]);return {App:app.default,AuthProvider:auth.AuthProvider};},
  render:({App,AuthProvider})=>root.render(<StrictMode><AuthProvider><App/></AuthProvider></StrictMode>),
  blocked:message=>root.render(<main role="alert">{message}</main>),
}).catch(()=>root.render(<main role="alert">ไม่สามารถเริ่มแอปได้ กรุณาตรวจ configuration</main>));
