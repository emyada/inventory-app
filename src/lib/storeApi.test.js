import test from 'node:test';
import assert from 'node:assert/strict';
import {sortByStoreOrder, moveItem, orderPayload, addToCart, cartLines, parseDuplicateSale, parseQty, saleTagKey, storeError, validateSaleTag} from './storeApi.js';
import {workspaceTabs} from './inventoryReports.js';
import {mutationParameters, readParameters} from './inventoryApi.js';
import {storeModeKeys} from './storeApi.js';

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
  assert.equal(mutationParameters.store_create_sale, 'tag lines reason');
  assert.equal(mutationParameters.store_transfer, 'lines note');
  assert.ok('store_list_stock' in readParameters && 'combined_balance' in readParameters);
});

import {stockLevel, lowStockCount, sortLowFirst, parseMinQty, soldBoard} from './storeApi.js';
test('stockLevel: no threshold = ok; out / low / ok by min_qty', () => {
  assert.equal(stockLevel({qty: 0, min_qty: null}), 'ok');
  assert.equal(stockLevel({qty: 0, min_qty: 3}), 'out');
  assert.equal(stockLevel({qty: 3, min_qty: 3}), 'low');
  assert.equal(stockLevel({qty: 4, min_qty: 3}), 'ok');
  assert.equal(stockLevel({qty: 1, min_qty: 0}), 'ok');
  assert.equal(lowStockCount([{qty: 0, min_qty: 2}, {qty: 1, min_qty: 2}, {qty: 9, min_qty: 2}, {qty: 1}]), 2);
});
test('sortLowFirst puts out then low first, keeps order of the rest', () => {
  const rows = [{n: 'a', qty: 9, min_qty: 2}, {n: 'b', qty: 1, min_qty: 2}, {n: 'c', qty: 0, min_qty: 2}, {n: 'd', qty: 5}];
  assert.deepEqual(sortLowFirst(rows).map(r => r.n), ['c', 'b', 'a', 'd']);
});
test('parseMinQty: blank clears, number ok, junk rejected', () => {
  assert.equal(parseMinQty(''), null);
  assert.equal(parseMinQty(' 5 '), 5);
  assert.equal(parseMinQty('0'), 0);
  assert.throws(() => parseMinQty('-1'));
  assert.throws(() => parseMinQty('abc'));
});
test('soldBoard = sold − cancelled (>0) plus main-stock sales, biggest first', () => {
  const out = soldBoard([{item_kind: 'model', item_id: 'm1', name: 'A', sold: 5, sale_cancelled: 2}, {item_kind: 'model', item_id: 'm2', name: 'B', sold: 1, sale_cancelled: 1}], [{material_id: 'x', name: 'X', unit: 'ชิ้น', qty: 7}]);
  assert.deepEqual(out.map(r => [r.name, r.qty]), [['X', 7], ['A', 3]]);
});

test('storeError maps SALE_REASON_REQUIRED to Thai', () => {
  assert.match(storeError(new Error('SALE_REASON_REQUIRED')), /เหตุผล/);
});

test('sell order: ordered items first, new items last by name, can move, payload keeps off-screen entries', () => {
  const items = [{kind: 'model', id: 'c', name: 'C'}, {kind: 'model', id: 'a', name: 'A'}, {kind: 'material', id: 'z', name: 'Zed'}, {kind: 'model', id: 'n', name: 'New'}];
  const order = [{item_kind: 'material', item_id: 'z', position: 0}, {item_kind: 'model', item_id: 'a', position: 1}, {item_kind: 'model', item_id: 'c', position: 2}, {item_kind: 'model', item_id: 'gone', position: 3}];
  const sorted = sortByStoreOrder(items, order);
  assert.deepEqual(sorted.map(i => i.id), ['z', 'a', 'c', 'n']);
  assert.deepEqual(sortByStoreOrder(items, []).map(i => i.id), ['a', 'c', 'n', 'z']);
  assert.deepEqual(moveItem(sorted, 1, -1).map(i => i.id), ['a', 'z', 'c', 'n']);
  assert.equal(moveItem(sorted, 0, -1), sorted);
  assert.equal(moveItem(sorted, 3, 1), sorted);
  const payload = orderPayload(moveItem(sorted, 3, -1), order);
  assert.deepEqual(payload.map(p => p.id), ['z', 'a', 'n', 'c', 'gone']);
  assert.equal(storeError(new Error('ORDER_INVALID')).includes('ลำดับ'), true);
  assert.equal(Object.hasOwn(mutationParameters, 'store_set_order'), true);
  assert.equal(Object.hasOwn(readParameters, 'store_list_order'), true);
});
test('store staff only sees sell, stock, sales (hidden: other, report)', () => {
  assert.deepEqual(storeModeKeys('store'), ['sell', 'stock', 'sales']);
  assert.deepEqual(storeModeKeys('admin'), ['stock', 'sales', 'sell', 'other', 'report']);
});
