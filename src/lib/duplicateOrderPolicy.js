// Offline policy oracle for the proposed backend contract. Never a client-side authorization gate.
export function numericOrderKey(reference) {
 if(typeof reference!=='string')return null;
 const match=/^(?:ZG|PL|PN|Z)?([0-9]+)$/i.exec(reference.trim());
 return match?match[1].replace(/^0+(?=\d)/,''):null;
}
export function duplicateIssueDecision(candidate,issued,{relationships=[]}={}) {
 if(candidate.category==='ซ่อมและอื่นๆ')return {status:'allowed',reason:'existing_repair_exception'};
 const key=orderIdentityKey(candidate.order_ref);
 if(!key||!candidate.parent_category||!['primary','supplemental'].includes(candidate.work_kind))return {status:'needs_review'};
 const previous=issued.filter(r=>r.issued_at&&r.category!=='ซ่อมและอื่นๆ'&&r.parent_category===candidate.parent_category&&orderIdentityKey(r.order_ref)===key);
 // Further lines for an already-issued request are not a new order. RPC operation replay is separate.
 if(previous.some(r=>r.request_id===candidate.request_id))return {status:'allowed',reason:'existing_request'};
 if(candidate.work_kind==='supplemental'&&!relationships.some(link=>link.supplemental_request_id===candidate.request_id&&link.parent_category===candidate.parent_category&&link.primary_request_id&&link.primary_request_id!==candidate.request_id))return {status:'relationship_required'};
 if(previous.some(r=>!['primary','supplemental'].includes(r.work_kind)))return {status:'needs_review'};
 for(const prior of previous){
  const primary=candidate.work_kind==='primary'?candidate:prior;
  const supplemental=candidate.work_kind==='supplemental'?candidate:prior;
  const related=candidate.work_kind!==prior.work_kind&&relationships.some(link=>link.primary_request_id===primary.request_id&&link.supplemental_request_id===supplemental.request_id&&link.parent_category===candidate.parent_category);
  if(!related)return {status:'duplicate',previous:prior};
 }
 return {status:'allowed',reason:'no_conflicting_issue'};
}
export function orderIdentityKey(reference){
 if(typeof reference!=='string'||!reference.trim())return null;
 const numeric=numericOrderKey(reference);
 return numeric===null?'text:'+reference.trim().toLowerCase():'numeric:'+numeric;
}
export function duplicateOrderWarning(error) {
 if(error?.message!=='DUPLICATE_ORDER_ISSUED')return null;
 let details;try{details=typeof error.details==='string'&&error.details.length<=4096?JSON.parse(error.details):null;}catch{details=null;}
 const safe=value=>typeof value==='string'?Array.from(value.slice(0,200),c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127?' ':c).join(''):'';
 const ref=safe(details?.previous_order_ref),actor=safe(details?.issuer_name);
 const date=typeof details?.issued_at==='string'&&Number.isFinite(Date.parse(details.issued_at))?new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}).format(new Date(details.issued_at)):'';
 return `เลขออเดอร์ซ้ำในหมวดเดียวกัน: มีการเบิกสำเร็จแล้ว${ref?` · อ้างอิง ${ref}`:''}${date?` · วันที่ ${date}`:''}${actor?` · ผู้เบิก ${actor}`:''}`;
}
