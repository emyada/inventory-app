export function createRefreshGroup() {
  const readers = new Set(); let flight;
  return {register(fn) { readers.add(fn); return () => readers.delete(fn); },
    refresh() {
      if (flight) return flight;
      flight = Promise.allSettled([...readers].map(fn => Promise.resolve().then(fn))).then(results => {
        if (results.some(r => r.status === 'rejected')) throw new Error('โหลดข้อมูลบางส่วนไม่สำเร็จ กรุณาลองใหม่');
      }).finally(() => { flight = null; });
      return flight;
    }};
}
export function pullDistance(start, point, top, touches = 1) {
  if (!start || !top || touches !== 1 || point.y < start.y || Math.abs(point.x-start.x)>30) return 0;
  return Math.min(100, (point.y-start.y)*0.5);
}
export function nestedScrollOrControl(target, root) {
  for(let el=target; el && el!==root; el=el.parentElement) {
    if (el.matches?.('input,textarea,select,button,a,[role="dialog"],[contenteditable="true"]')) return true;
    if (el.scrollHeight>el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) return true;
  }
  return false;
}
