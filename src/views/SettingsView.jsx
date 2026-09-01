import React, { useEffect, useState } from 'react';
import { Save, Users } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { C, inputStyle, btnPrimary } from '../theme';

export function SettingsView({ webhookUrl, onSaveWebhook }) {
  const [url, setUrl] = useState(webhookUrl || '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);

  useEffect(() => {
    supabase.from('profiles').select('*').order('full_name').then(({ data }) => {
      setProfiles(data || []);
      setLoadingProfiles(false);
    });
  }, []);

  async function saveWebhook() {
    setSaving(true);
    await onSaveWebhook(url.trim());
    setSavedMsg('บันทึกแล้ว');
    setSaving(false);
    setTimeout(() => setSavedMsg(''), 2000);
  }

  async function changeRole(id, role) {
    await supabase.from('profiles').update({ role }).eq('id', id);
    setProfiles(profiles.map(p => p.id === id ? { ...p, role } : p));
  }

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>ตั้งค่า (หัวหน้าช่างเท่านั้น)</div>

      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Google Sheets Webhook URL</div>
        <div style={{ fontSize: 11.5, color: C.textDim, marginBottom: 8, lineHeight: 1.5 }}>
          URL จาก Google Apps Script ที่ deploy เป็น Web App (ดูวิธีตั้งค่าใน README.md หัวข้อ "Google Sheets sync")
        </div>
        <input style={inputStyle} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" />
        <button onClick={saveWebhook} disabled={saving} style={{ ...btnPrimary, marginTop: 8, width: '100%' }}>
          <Save size={14} style={{ marginRight: 6 }} /> {saving ? 'กำลังบันทึก...' : 'บันทึก URL'}
        </button>
        {savedMsg && <div style={{ fontSize: 11.5, color: C.teal, marginTop: 6, textAlign: 'center' }}>{savedMsg}</div>}
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          <Users size={14} /> ผู้ใช้งานและสิทธิ์
        </div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10, lineHeight: 1.5 }}>
          การสร้างบัญชีใหม่ทำใน Supabase Dashboard → Authentication → Users → Add user
          (มีแค่คุณที่เข้าถึง Dashboard ได้) จากนั้นตั้งสิทธิ์ให้แต่ละคนได้ที่นี่
        </div>
        {loadingProfiles && <div style={{ fontSize: 12, color: C.textDim }}>กำลังโหลด...</div>}
        {profiles.map(p => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 12.5 }}>{p.full_name}</div>
            <select value={p.role} onChange={e => changeRole(p.id, e.target.value)} style={{ ...inputStyle, width: 130 }}>
              <option value="staff">ทีมผลิต (staff)</option>
              <option value="purchasing">จัดซื้อ (purchasing)</option>
              <option value="admin">หัวหน้าช่าง (admin)</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
