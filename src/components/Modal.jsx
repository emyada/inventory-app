import React from 'react';
import { X } from 'lucide-react';
import { C } from '../theme';

export function Modal({ children, onClose, title }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 30 }}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: '16px 16px 0 0', padding: 18, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer' }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
