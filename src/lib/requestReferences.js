export const requestReferenceContract='p1-request-reference-v1';
export function previewReference(model,raw,{repair=false}={}) {
 const input=String(raw??'').trim();
 if(repair)return {raw:String(raw??''),canonical:input||null};
 if(!input)throw new Error('กรุณาระบุเลขออเดอร์');
 if(model?.request_contract===requestReferenceContract && (model.work_kind==='supplemental'||['Sleepplug','Lifestyle'].includes(model.category))){
  if(!/^[0-9]+$/.test(input))throw new Error('กรอกเฉพาะตัวเลขออเดอร์');
  if(model.work_kind!=='supplemental'&&typeof model.order_prefix!=='string')throw new Error('Admin ยังไม่ได้กำหนด prefix ของรุ่น');
  return {raw:String(raw),canonical:(model.work_kind==='supplemental'?'':model.order_prefix||'')+input};
 }
 return {raw:String(raw),canonical:input};
}
export async function attachRequestSettings(api,models) {
 if(!api.request_reference_settings)return models;
 let settings;
 try{settings=await api.request_reference_settings();}catch(e){
  if(['PGRST202','42883'].includes(e?.code))return models; // old backend remains explicit legacy contract
  throw e;
 }
 if(settings?.contract!==requestReferenceContract||!Array.isArray(settings.models))throw new Error('Invalid request reference contract');
 return models.map(m=>({...m,request_contract:settings.contract,...settings.models.find(s=>s.model_id===m.id)}));
}
