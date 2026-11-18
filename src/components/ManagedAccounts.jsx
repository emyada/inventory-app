import React, { useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export function ManagedAccounts() {
  const [open,setOpen]=useState(false), [accounts,setAccounts]=useState([]), [busy,setBusy]=useState(false);
  const [id,setId]=useState(''), [message,setMessage]=useState('');
  const inFlight=useRef(false);
  const selected=accounts.find(row=>row.id===id);
  async function call(body) {
    const {data:{session}}=await supabase.auth.getSession();
    if (!session) throw new Error('กรุณาเข้าสู่ระบบอีกครั้ง');
    const response=await fetch('/api/stock-accounts',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error);
    return result;
  }
  async function run(body) {
    if(inFlight.current)return;
    inFlight.current=true;
    setBusy(true);setMessage('');
    try {
      if(body) await call(body);
      setAccounts((await call({action:'list'})).accounts);
      if(body) setMessage(body.action==='health'?'บริการจัดการบัญชีพร้อมใช้งาน':'บันทึกแล้ว');
    } catch(error) {setMessage(error.message || 'โหลดรายการอีกครั้งเพื่อตรวจผล');}
    finally {inFlight.current=false;setBusy(false);}
  }
  function submit(event) {
    event.preventDefault();
    const form=event.currentTarget, data=new FormData(form);
    const action=event.nativeEvent.submitter?.value;
    if(!action) return;
    const body={action,id};
    if(action==='create'||action==='edit') Object.assign(body,{name:data.get('name'),role:data.get('role')});
    if(action==='create') body.username=data.get('username');
    if(action==='create'||action==='reset') body.password=data.get('password');
    form.elements.password.value='';
    void run(body);
  }
  return <>
    <button type="button" className="inv-hdr-icon" aria-label="จัดการบัญชีผู้ใช้" title="จัดการบัญชีผู้ใช้" disabled={busy} aria-expanded={open} onClick={()=>{setOpen(!open);if(!open) void run();}}><Users size={18}/></button>
    {open&&<div className="inv-hdr-panel"><button type="button" className="inv-hdr-close" aria-label="ปิดแผงจัดการบัญชี" onClick={()=>setOpen(false)}>ปิด</button><fieldset disabled={busy}><legend>บัญชีพนักงาน</legend>
      <label>เลือกบัญชี <select value={id} onChange={e=>{setId(e.target.value);setMessage('');}}><option value="">สร้างบัญชีใหม่</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.username} · {a.enabled?'เปิดใช้งาน':'ระงับ'}</option>)}</select></label>
      <form key={id} onSubmit={submit}>
        {!selected&&<label>ชื่อผู้ใช้ <input name="username" required maxLength={64} autoCapitalize="none"/></label>}
        <label>ชื่อแสดงผล <input name="name" required maxLength={120} defaultValue={selected?.full_name}/></label>
        <label>สิทธิ์ <select name="role" defaultValue={selected?.role||'staff'}>{['staff','admin','purchasing','store'].map(r=><option key={r} value={r}>{({staff:'staff — ทีมผลิต',admin:'admin — หัวหน้าสต๊อก',purchasing:'purchasing — จัดซื้อ',store:'store — พนักงานหน้าร้าน'})[r]}</option>)}</select></label>
        <label>รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร ใช้ตัวเลขได้) <input name="password" type="password" autoComplete="new-password" required={!selected} minLength={8} maxLength={128}/></label>
        <button value={selected?'edit':'create'}>{selected?'บันทึกชื่อและสิทธิ์':'สร้างบัญชี'}</button>
        {selected&&<><button value="reset">ตั้งรหัสผ่านใหม่</button><button type="button" onClick={()=>void run({action:selected.enabled?'disable':'enable',id})}>{selected.enabled?'ระงับบัญชี':'เปิดใช้บัญชี'}</button></>}
      </form><span role="status">{busy?'กำลังดำเนินการ…':message}</span>
      <details className="inv-adv"><summary>ทดสอบระบบ</summary><button type="button" onClick={()=>void run({action:'health'})}>ทดสอบระบบบัญชี</button><p className="inv-muted">ใช้เมื่อสร้างบัญชีหรือเปลี่ยนรหัสไม่สำเร็จ ไม่แก้ไขข้อมูลใดๆ</p></details>
    </fieldset></div>}
  </>;
}
