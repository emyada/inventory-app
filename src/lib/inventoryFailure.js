// Only a structured response from the mutation endpoint proves its rollback.
// Arbitrary thrown errors, lookup errors and HTTP status alone do not.
const databaseFailures = new WeakSet();
const sqlstate = /^(?:(?:[0-9]{2}|P0|F0|HV|XX)[0-9A-Z]{3}|PGRST[0-3][0-9]{2})$/;
export function rpcResponseError(responseError, {mutation = false} = {}) {
  const error = new Error(responseError?.message || 'Inventory RPC failed');
  error.code=responseError?.code;error.details=responseError?.details;error.hint=responseError?.hint;
  const structured = responseError && typeof responseError === 'object'
    && typeof responseError.message === 'string' && responseError.message.trim()
    && typeof responseError.code === 'string' && sqlstate.test(responseError.code)
    && !responseError.code.startsWith('00');
  error.uncertain=!(mutation && structured);
  if(!error.uncertain)databaseFailures.add(error);
  return error;
}
export const isDefinitiveFailure = error => databaseFailures.has(error) && error.uncertain === false;
export function retainFailure(error) {
  error.uncertain=true;
  error.replayCleanupFailed=true;
  return error;
}

export function rpcData(response, {mutation = false} = {}) {
  if(response?.error)throw rpcResponseError(response.error,{mutation});
  if(!response || typeof response!=='object' || !Object.hasOwn(response,'data')
    || response.data===undefined || (mutation && response.data===null)
    || (typeof response.status==='number' && response.status>=400)) {
    const error=new Error('ไม่ได้รับผลฐานข้อมูลที่ยืนยันได้ กรุณาตรวจ UUID เดิม');
    error.uncertain=true;throw error;
  }
  return response.data;
}
