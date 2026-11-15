import test from 'node:test';
import assert from 'node:assert/strict';
import {addToCart, cartLines, parseDuplicateSale, parseQty, saleTagKey, storeError, validateSaleTag} from './storeApi.js';
import {workspaceTabs} from './inventoryReports.js';
import {mutationParameters, readParameters} from './inventoryApi.js';

test('sale tag normalisation ignores case, spaces and separators like the database', () => {
  assert.equal(saleTagKey(' shp-1001 '), 'SHP1001');
  assert.equal(saleTagKey('SHP 1001'), saleTagKey('shp_1001'));
  assert.equal(saleTagKey('shp/10.01'), 'SHP1001');
});
test('sale tag is mandatory (3-64 chars after normalisation)', () => {
  assert.throws(() => validateSaleTag(''), /แท็ก/);
  assert.throws(() => validateSaleTag('  '), /แท็ก/);
  assert.throws(() => validateSaleTag('a-'), /แท็ก/);
  assert.throws(() => validateSaleTag('x'.repeat(65)), /ยาวเกิน/);
  assert.equal(validateSaleTag('  SHP-1001 '), 'SHP-1001');
});
test('duplicate sale tag error exposes who/when from DETAIL json', () => {
  const error = {message: 'DUPLICATE_SALE_TAG', details: JSON.stringify({tag: 'SHP-1', seller_name: 'ช่างเอ', sale_id: 'abc'})};
  assert.deepEqual(parseDuplicateSale(error), {tag: 'SHP-1', seller_name: 'ช่างเอ', sale_id: 'abc'});
  assert.deepEqual(parseDuplicateSale({message: 'DUPLICATE_SALE_TAG', details: 'broken'}), {});
  assert.equal(parseDuplicateSale({message: 'other'}), null);
  assert.match(storeError(error), /ถูกใช้ไปแล้ว/);
});
test('quantities: models are whole sets, parts may be decimal, never zero', () => {
  assert.equal(parseQty('3', 'model'), 3);
  assert.equal(parseQty('2.5', 'material'), 2.5);
  assert.throws(() => parseQty('2.5', 'model'), /จำนวนเต็ม/);
  assert.throws(() => parseQty('0', 'material'), /มากกว่า 0/);
  assert.throws(() => parseQty('abc', 'material'));
});
test('cart merges the same item and sends only kind/id/qty', () => {
  let cart = addToCart([], {kind: 'model', id: 'm1', name: 'Music', unit: 'ชุด'}, 2);
  cart = addToCart(cart, {kind: 'model', id: 'm1', name: 'Music', unit: 'ชุด'}, 3);
  cart = addToCart(cart, {kind: 'material', id: 'x', name: 'กล่อง', unit: 'pcs'}, 1);
  assert.deepEqual(cartLines(cart), [{kind: 'model', id: 'm1', qty: 5}, {kind: 'material', id: 'x', qty: 1}]);
});
test('store role only sees the store tab; admin gets the store tab; purchasing has no store tab', () => {
  assert.deepEqual(workspaceTabs('store'), ['store']);
  assert.ok(workspaceTabs('admin').includes('store'));
  assert.ok(!workspaceTabs('purchasing').includes('store'));
  assert.ok(!workspaceTabs('staff').includes('store'));
});
test('store RPC contracts', () => {
  assert.equal(mutationParameters.store_create_sale, 'tag lines');
  assert.equal(mutationParameters.store_transfer, 'lines note');
  assert.ok('store_list_stock' in readParameters && 'combined_balance' in readParameters);
});
