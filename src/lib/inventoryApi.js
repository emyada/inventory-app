import { assertInventoryMutation } from './inventoryEnvironment.js';
import { rpcData } from './inventoryFailure.js';
import { createInventoryOperation } from './inventoryOperation.js';

// Exact named RPC parameters; omitted optional arguments use database defaults.
export const mutationParameters = Object.freeze({
  create_material: 'name unit low_stock_threshold initial_qty reason requires_picking',
  update_material: 'material_id name unit low_stock_threshold requires_picking',
  set_material_active: 'material_id is_active reason',
  receive_purchase: 'material_id quantity reference note',
  stocktake: 'material_id counted_qty reason expected_version',
  create_request: 'model_id order_ref repair_spec',
  confirm_pick: 'items',
  cancel_request: 'transaction_id reason legacy_return_verified',
  save_model: 'model_id name category bom',
  set_model_active: 'model_id is_active reason',
});
export const readParameters = Object.freeze({
  get_operation_result: 'operation_id',
  list_materials: 'include_inactive',
  list_my_requests: 'after_at after_id limit',
  list_pick_queue: 'after_at after_id limit',
  balance_report: 'date_from date_to timezone',
  list_movements: 'material_id from to after_sequence cutoff_sequence limit',
});
function parameters(allowed, input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('RPC input must be an object');
  const keys = allowed.split(' ');
  for (const key of Object.keys(input)) {
    if (!keys.includes(key)) throw new Error(`Unsupported RPC parameter: ${key}`);
  }
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)
    .map(([key, value]) => [`p_${key}`, value]));
}
export function createInventoryApi(client, { uuid, operationStore, mutationsEnabled = false, assertAccess = () => {} } = {}) {
  async function call(name, args) {
    assertAccess();
    if(Object.hasOwn(mutationParameters,name))assertInventoryMutation(mutationsEnabled);
    const result = await client.rpc(`inventory_${name}`, args);
    return rpcData(result,{mutation:Object.hasOwn(mutationParameters,name)});
  }
  const api = {};
  for (const [name, allowed] of Object.entries(mutationParameters)) {
    // Preparing is local only. execute()/retry() is the sole network entry point.
    api[name] = (input, { intentKey = name } = {}) => {
      assertAccess();assertInventoryMutation(mutationsEnabled);
      return createInventoryOperation(
      (id, args) => call(name, { ...args, p_operation_id: id }), parameters(allowed, input), uuid,
      { store: operationStore, intentKey: `${name}:${intentKey}` });
    };
  }
  for (const [name, allowed] of Object.entries(readParameters)) {
    api[name] = (input = {}) => call(name, parameters(allowed, input));
  }
  return Object.freeze(api);
}
