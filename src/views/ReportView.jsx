async function handleSendToSheet() {
    setSending(true);
    setSendMsg('กำลังส่งข้อมูลสรุปประจำเดือน...');
    
    // ดึงปี-เดือน จากวันที่เลือก เช่น '2026-09'
    const monthKey = from.slice(0, 7); 
    const sheetName = `Report_${monthKey}`; // ชื่อ Tab ใน Google Sheet เช่น Report_2026_09

    // รวมข้อมูลสรุปยอดผลิต และสรุปวัตถุดิบเข้าด้วยกันเพื่อส่งรอบเดียว
    const payload = [
      ...rowsSummaryExport(),
      { หมวดหมู่: '--- สรุปวัตถุดิบ ---', รุ่นสินค้า: '', จำนวนที่ผลิต: '' }, // แถบคั่น
      ...rowsMaterialExport().map(m => ({
        หมวดหมู่: m.ชื่อวัตถุดิบ,
        รุ่นสินค้า: `หน่วย: ${m.หน่วย}`,
        จำนวนที่ผลิต: m.ยอดเบิกรวม
      }))
    ];

    const { error } = await sendToGoogleSheet(sheetsWebhookUrl, sheetName, payload);

    if (error) {
      setSendMsg(`เกิดข้อผิดพลาด: ${error}`);
    } else {
      setSendMsg(`ส่งข้อมูลเข้า Tab [${sheetName}] เรียบร้อยแล้ว!`);
    }
    
    setSending(false);
  }
