import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { C, sans, inputStyle, btnPrimary } from '../theme';

// Staff never see or type an email — they just use a short username.
// Behind the scenes, Supabase Auth still requires an email-shaped identifier,
// so we turn "somchai" into "somchai@iem-workshop.local" before signing in.
// When you (admin) create a login in Supabase > Authentication > Users, use
// that same "username@iem-workshop.local" pattern as the email field.
const USERNAME_DOMAIN = 'iem-workshop.local';

function usernameToEmail(username) {
  const clean = username.trim().toLowerCase().replace(/\s+/g, '');
  return `${clean}@${USERNAME_DOMAIN}`;
}

export default function Login() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim()) return;
    setBusy(true); setError('');
    const { error } = await signIn(usernameToEmail(username), password);
    if (error) setError(`เข้าสู่ระบบไม่สำเร็จ: ${error.message}`);
    setBusy(false);
  }

  return (
    <div style={{ ...sans, background: C.bg, color: C.text, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, boxSizing: 'border-box' }}>
      <form onSubmit={handleSubmit} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 26, width: '100%', maxWidth: 340, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: C.amber, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
            <Package size={22} color={C.bg} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>ห้องคลัง — IEM Workshop</div>
          <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 2 }}>เข้าสู่ระบบด้วยบัญชีที่หัวหน้าช่างสร้างให้</div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>ชื่อผู้ใช้</div>
          <input style={inputStyle} type="text" required value={username} onChange={e => setUsername(e.target.value)} placeholder="เช่น somchai" autoCapitalize="none" autoCorrect="off" />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>รหัสผ่าน</div>
          <input style={inputStyle} type="password" required value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ ...btnPrimary, width: '100%', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
        </button>
        <div style={{ fontSize: 10.5, color: C.textDim, marginTop: 14, textAlign: 'center', lineHeight: 1.5 }}>
          ยังไม่มีบัญชี? ติดต่อหัวหน้าช่าง/หัวหน้าสต๊อกให้สร้างบัญชีให้ในระบบก่อน
        </div>
      </form>
    </div>
  );
}
