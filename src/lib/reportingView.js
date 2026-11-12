import {loadReportingDataset, bangkokBounds} from './reportingEngine.js';
export const REPORT_VIEWS = ['All Products','All Materials','CIEM','Tactical','Lifestyle','Sleepplug','Repair & Others'];
export const modelKey = row => JSON.stringify([row.report_category,row.model_id,row.model_name]);
export function selectReport(report, view, model = '') {
  const category = ['All Products','All Materials'].includes(view) ? null : view;
  const match = row => (!category || row.report_category === category) && (!model || modelKey(row) === model);
  return {products:report.products.filter(match), materials:view==='All Materials'?report.materials:report.model_materials.filter(match), orders:report.orders.filter(match), evidence:report.evidence.filter(match)};
}
export async function fetchReportingView(api, role, filters) {
  if(role!=='admin') return {status:'denied'};
  if(!filters.mappingRevision?.trim()) return {status:'mapping'};
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.mappingRevision)) return {status:'error',message:'Mapping revision UUID ไม่ถูกต้อง'};
  try {
    bangkokBounds(filters.from,filters.to);
    let failure;
    const client={rpc:async(name,args)=>{
      if(name!=='reporting_read_evidence_v1') throw new Error('Unsupported report read');
      try {
        const result=await api.reporting_read_evidence(args); failure=result.error; return result;
      } catch(error) { failure=error; throw error; }
    }};
    try { return {status:'ready',report:await loadReportingDataset(client,filters)}; }
    catch(error) {
      if(failure?.code==='42501') return {status:'denied'};
      if(failure?.message==='Unknown mapping') return {status:'mapping'};
      if(failure?.code==='54000') return {status:'error',message:'ข้อมูลเกินขีดจำกัดรายงาน ไม่แสดงผลบางส่วน กรุณาติดต่อผู้ดูแล'};
      throw error;
    }
  } catch { return {status:'error',message:'โหลดรายงานไม่สำเร็จ ตรวจสอบช่วงวันที่และการเชื่อมต่อ แล้วลองใหม่ ไม่แสดงยอดบางส่วน'}; }
}
