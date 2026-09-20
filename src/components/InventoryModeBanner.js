import { createElement } from 'react';
export function InventoryModeBanner({policy}) {
  return policy.banner ? createElement('aside',{role:'status'},policy.banner) : null;
}
