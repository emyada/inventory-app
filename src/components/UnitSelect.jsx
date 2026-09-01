import React, { useState } from 'react';
import { inputStyle, UNIT_OPTIONS } from '../theme';

export function UnitSelect({ value, onChange }) {
  const isCustom = value && !UNIT_OPTIONS.includes(value);
  const [custom, setCustom] = useState(isCustom ? value : '');
  return (
    <div>
      <select style={inputStyle} value={isCustom ? 'อื่นๆ' : value} onChange={e => {
        if (e.target.value === 'อื่นๆ') { onChange(custom || ''); } else { onChange(e.target.value); }
      }}>
        {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
      </select>
      {(isCustom || value === '') && (
        <input style={{ ...inputStyle, marginTop: 6 }} placeholder="ระบุหน่วยเอง เช่น หลอด, ม้วน"
          value={isCustom ? value : custom}
          onChange={e => { setCustom(e.target.value); onChange(e.target.value); }} />
      )}
    </div>
  );
}
