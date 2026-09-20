import React from 'react';
import { useInventoryOperation } from '../hooks/useInventoryOperation.js';

// Not mounted in existing workflow during Phase A.
export function InventoryOperationButton({ operation, children, disabled = false }) {
  const { status, loading, error, storageError, needsReview, execute } = useInventoryOperation(operation);
  return (
    <div>
      <button type="button" disabled={disabled || loading || status === 'succeeded'}
        aria-busy={loading} onClick={() => { execute().catch(() => {}); }}>
        {loading ? 'กำลังส่ง…' : status === 'succeeded' ? 'สำเร็จแล้ว' : children}
      </button>
      {needsReview && <p role="status">ต้องตรวจสอบ/ลองใหม่ — ใช้ UUID เดิม</p>}
      {storageError && <p role="status">{storageError.message}</p>}
      {error && <p role="alert">{error.message}{status === 'unknown' && ' — ยังไม่ทราบผล กรุณาลองอีกครั้งด้วยรายการเดิม'}</p>}
    </div>
  );
}
