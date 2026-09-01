// Sends report rows to a Google Sheet via a Google Apps Script "Web App" endpoint.
// Why this approach: Google Sheets has no public REST endpoint that accepts anonymous
// writes, so the standard, no-backend-needed way to do this is to deploy a small Apps
// Script bound to the target Sheet, publish it as a Web App, and POST JSON to it.
// See README.md "Google Sheets sync" section for the exact Apps Script code + deploy steps.

export async function sendToGoogleSheet(webhookUrl, sheetName, rows) {
  if (!webhookUrl) return { error: 'ยังไม่ได้ตั้งค่า Google Sheets Webhook URL (ดูวิธีตั้งค่าในหน้า Settings)' };
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids a CORS preflight against Apps Script
      body: JSON.stringify({ sheetName, rows }),
    });
    const ok = res.ok;
    if (!ok) return { error: `ส่งไม่สำเร็จ (HTTP ${res.status})` };
    return { error: null };
  } catch (e) {
    return { error: 'ส่งไม่สำเร็จ — เช็คอินเทอร์เน็ตหรือ Webhook URL' };
  }
}
