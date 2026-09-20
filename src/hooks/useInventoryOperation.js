import { useSyncExternalStore } from 'react';

// Caller retains one prepared operation per intent (useState/useRef), not per render/click.
export function useInventoryOperation(operation) {
  const state = useSyncExternalStore(operation.subscribe, operation.getSnapshot, operation.getSnapshot);
  return { ...state, operationId: operation.id, execute: operation.execute, retry: operation.retry };
}
