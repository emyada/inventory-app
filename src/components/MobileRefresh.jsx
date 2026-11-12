import React,{useContext,useRef,useState} from 'react';
import {RefreshContext,RefreshActionContext} from '../hooks/useRefreshRead.js';
import {createRefreshGroup,nestedScrollOrControl,pullDistance} from '../lib/mobileRefresh.js';
export function MobileRefresh({children,blocked=false,onRefresh}) {
  const [group]=useState(createRefreshGroup),[distance,setDistance]=useState(0),[status,setStatus]=useState('');
  const busy=useRef(false),dirty=useRef(false),start=useRef(null),distanceRef=useRef(0);
  const refresh=async()=>{
    if(busy.current)return;
    if(blocked){setStatus('ปิดฟอร์มหรือรอทำรายการเสร็จก่อนโหลดใหม่');return;}
    if(dirty.current&&!window.confirm('มีข้อมูลที่แก้ไขค้างอยู่ ต้องการโหลดข้อมูลใหม่หรือไม่?'))return;
    busy.current=true;setStatus('กำลังโหลดข้อมูลใหม่…');
    try{await onRefresh?.();await group.refresh();setStatus('โหลดข้อมูลใหม่แล้ว');}catch{setStatus('โหลดข้อมูลบางส่วนไม่สำเร็จ กรุณาลองใหม่');}finally{busy.current=false;}
  };
  const cancel=()=>{start.current=null;distanceRef.current=0;setDistance(0);};
  return <RefreshContext.Provider value={group}><RefreshActionContext.Provider value={refresh}><div className="inv-refresh-root" onChangeCapture={()=>{dirty.current=true;}}
    onTouchStart={e=>{cancel();if(e.touches.length===1&&window.scrollY<=0&&!nestedScrollOrControl(e.target,e.currentTarget)){start.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}}}
    onTouchMove={e=>{const t=e.touches[0];if(!t)return;const d=pullDistance(start.current,{x:t.clientX,y:t.clientY},window.scrollY<=0,e.touches.length);if(!d){cancel();return;}distanceRef.current=d;setDistance(d);}}
    onTouchCancel={cancel} onTouchEnd={()=>{const fire=distanceRef.current>=60;cancel();if(fire)void refresh();}}>
    <div className="inv-refresh-status" role="status" aria-live="polite">{distance?distance>=60?'ปล่อยเพื่อโหลดข้อมูลใหม่':'ดึงลงเพื่อโหลดข้อมูลใหม่':status}</div>
    {children}
  </div></RefreshActionContext.Provider></RefreshContext.Provider>;
}

export function RefreshButton({disabled,children}) { const refresh=useContext(RefreshActionContext); return <button aria-label="โหลดข้อมูลใหม่" disabled={disabled} onClick={refresh}>{children}</button>; }
