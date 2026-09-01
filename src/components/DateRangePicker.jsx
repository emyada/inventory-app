import React from 'react';
import { C, inputStyle } from '../theme';

export function DateRangePicker({ from, to, setFrom, setTo }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
      <span style={{ color: C.textDim, fontSize: 12 }}>ถึง</span>
      <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
    </div>
  );
}
