export const C = {
  bg: '#16181C',
  panel: '#1F2227',
  panelAlt: '#252932',
  line: '#33383F',
  text: '#EDEAE2',
  textDim: '#9A9FA8',
  amber: '#E8A33D',
  teal: '#3FA796',
  red: '#D97757',
  redDim: '#8C4A3E',
};
export const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace" };
export const sans = { fontFamily: "'Inter', system-ui, -apple-system, sans-serif" };

export const CATEGORIES = ['CIEM', 'Tactical', 'Lifestyle', 'Sleepplug', 'ซ่อม&อื่นๆ'];
export const UNIT_OPTIONS = ['g', 'kg', 'ml', 'l', 'pcs', 'set', 'pack', 'ชิ้น', 'คู่', 'ม้วน', 'แผ่น', 'ห่อ', 'กล่อง', 'เมตร', 'อื่นๆ'];

export const inputStyle = { width: '100%', background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 7, padding: '8px 10px', color: C.text, fontSize: 13, boxSizing: 'border-box' };
export const btnPrimary = { background: C.amber, color: C.bg, border: 'none', borderRadius: 8, padding: '10px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
export const btnGhost = { background: 'none', border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center' };
export const stepperBtn = { background: C.panelAlt, border: `1px solid ${C.line}`, color: C.text, borderRadius: 7, padding: '8px 9px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
export const tabBtn = { flex: 1, background: 'none', border: `1px solid ${C.line}`, color: C.textDim, borderRadius: 8, padding: '7px 8px', fontSize: 11.5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 };
export const tabBtnActive = { background: 'rgba(232,163,61,0.14)', borderColor: C.amber, color: C.amber };

export function todayStr() { return new Date().toISOString().slice(0, 10); }
export function monthStartStr() { return todayStr().slice(0, 8) + '01'; }
