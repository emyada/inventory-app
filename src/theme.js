export const C = {
  bg: '#121316',
  panel: '#1E2026',
  panelAlt: '#252830',
  line: '#2B2D31',
  text: '#F3F4F6',
  textDim: '#9CA3AF',
  amber: '#F59E0B',
  teal: '#10B981',
  red: '#EF4444',
};

export const mono = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

export const btnGhost = {
  display: 'flex',
  alignItems: 'center',
  padding: '10px 14px',
  minHeight: '42px',
  fontSize: '14px',
  fontWeight: '600',
  color: C.text,
  backgroundColor: C.panel,
  border: `1px solid ${C.line}`,
  borderRadius: '10px',
  cursor: 'pointer',
};

export const CATEGORIES = ['CIEM', 'Tactical', 'Lifestyle', 'Sleepplug', 'ซ่อมและอื่นๆ'];

export const todayStr = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
};
