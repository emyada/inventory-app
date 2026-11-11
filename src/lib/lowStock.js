// Derived only from authorized material reads; never supplies a default threshold.
function validNumber(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim()==='') return null;
  const number=Number(value);
  return Number.isFinite(number)&&number>=0?number:null;
}
export function stockAlert(material) {
  const quantity=validNumber(material.qty),threshold=validNumber(material.low_stock_threshold);
  const status=quantity===null?'unknown':quantity===0?'out':threshold===null?'unconfigured':quantity<=threshold?'low':'ok';
  return {status,quantity,threshold,affected:status==='out'||status==='low'};
}
export function stockSummary(materials) {
  const active=materials.filter(m=>m.is_active);
  return {affected:active.filter(m=>stockAlert(m).affected),out:active.filter(m=>stockAlert(m).status==='out').length,
    low:active.filter(m=>stockAlert(m).status==='low').length,unconfigured:active.filter(m=>stockAlert(m).threshold===null).length};
}
