import test from 'node:test';
import assert from 'node:assert/strict';
import {latestSales, sortByStoreOrder, moveItem, orderPayload, addToCart, cartLines, parseDuplicateSale, parseQty, saleTagKey, storeError, validateSaleTag} from './storeApi.js';
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
  assert.equal(mutationParameters.store_create_sale, 'tag lines reason other');
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

test('latestSales: newest 3 first, tolerates empty', () => {
  const rows = ['2026-11-19T09:11:00Z', '2026-11-19T09:29:00Z', '2026-11-19T09:28:00Z', '2026-11-18T01:00:00Z'].map((created_at, i) => ({sale_id: i, created_at}));
  assert.deepEqual(latestSales(rows).map(r => r.sale_id), [1, 2, 0]);
  assert.deepEqual(latestSales(rows, 1).map(r => r.sale_id), [1]);
  assert.deepEqual(latestSales(null), []);
});

import {buildChannelPattern, matchChannel, tagChannelState, tagChannelOk, channelOtherFlag, describeChannelRule, TAG_MISMATCH_TEXT} from './storeApi.js';
const CHANNELS = [
  {code: 'tiktok', name: 'TikTok', color: 'red', active: true, pattern: '^[0-9]{18}$', spec: {prefix: '', digits: 18, with_date: false, with_seq: false}},
  {code: 'shipnity', name: 'Shipnity', color: 'blue', active: true, pattern: buildChannelPattern({prefix: 'RE', digits: 6, with_date: true, with_seq: true}), spec: {prefix: 'RE', digits: 6, with_date: true, with_seq: true}},
  {code: 'other', name: 'อื่นๆ', color: 'amber', active: true, pattern: null, is_system: true},
];
test('channel lock: the 13 real tags match, typos do not', () => {
  for (const t of ['587229145958089832', '587270671046509775', 'RE261118-29', 're261120-6', ' RE261116-26 ', 'RE261120-9999']) assert.ok(matchChannel(t, CHANNELS), t);
  assert.equal(matchChannel('587229145958089832', CHANNELS).code, 'tiktok');
  assert.equal(matchChannel('RE261118-29', CHANNELS).code, 'shipnity');
  for (const t of ['', 'ABC-99', '58722914595808983', '5872291459580898321', 'RE261345-3', 'RE261132-3', 'RE2611183', 'AB261120-5', 'RE261120-0', 'RE261120-05', 'RE261120-12345', 'REA 261120-79']) assert.equal(matchChannel(t, CHANNELS), null, t);
});
test('channel lock: disabled channel no longer matches; tick อื่นๆ allows a mismatch', () => {
  const off = CHANNELS.map(c => c.code === 'tiktok' ? {...c, active: false} : c);
  assert.equal(matchChannel('587229145958089832', off), null);
  assert.equal(tagChannelState('ABC-99', CHANNELS, false).state, 'mismatch');
  assert.equal(tagChannelState('ABC-99', CHANNELS, true).state, 'other');
  assert.equal(tagChannelState('587229145958089832', CHANNELS, true).state, 'match');
  assert.equal(tagChannelState('', CHANNELS, false).state, 'empty');
  assert.equal(tagChannelOk('ABC-99', CHANNELS, false), false);
  assert.equal(tagChannelOk('ABC-99', CHANNELS, true), true);
  assert.equal(tagChannelOk('ABC-99', [], false), true);
  assert.equal(tagChannelOk('', CHANNELS, false), true);
  assert.deepEqual(channelOtherFlag('ABC-99', CHANNELS, true), {other: true});
  assert.deepEqual(channelOtherFlag('587229145958089832', CHANNELS, true), {});
  assert.deepEqual(channelOtherFlag('ABC-99', CHANNELS, false), {});
  assert.equal(storeError(new Error('TAG_CHANNEL_MISMATCH')), TAG_MISMATCH_TEXT);
});
test('buildChannelPattern mirrors the database rule builder', () => {
  assert.equal(buildChannelPattern({prefix: 'lz', digits: 15}), '^LZ[0-9]{15}$');
  assert.equal(buildChannelPattern({prefix: '', digits: 18}), '^[0-9]{18}$');
  assert.ok(buildChannelPattern({prefix: '', with_date: true, with_seq: true}).startsWith('^[A-Z]{1,3}'));
  assert.equal(buildChannelPattern({prefix: 'bad prefix', digits: 5}), null);
  assert.equal(buildChannelPattern({prefix: '', digits: 0}), null);
  assert.equal(buildChannelPattern({prefix: '', digits: 5, with_seq: true}), null);
  assert.equal(describeChannelRule(CHANNELS[0]), 'ตัวเลขล้วน 18 หลัก');
  assert.match(describeChannelRule(CHANNELS[1]), /^RE \+ วันที่ 6 หลัก/);
});

test('channel lock: Shipnity date must exist and not be after today (Bangkok)', () => {
  const now = Date.parse('2026-11-20T10:00:00+07:00');
  assert.equal(matchChannel('RE261120-1', CHANNELS, now)?.code, 'shipnity');
  assert.equal(matchChannel('RE261119-9', CHANNELS, now)?.code, 'shipnity');
  assert.equal(matchChannel('RE261121-1', CHANNELS, now), null, 'tomorrow');
  assert.equal(matchChannel('RE270101-1', CHANNELS, now), null, 'next year');
  assert.equal(matchChannel('RE260230-1', CHANNELS, now), null, '30 Feb does not exist');
  assert.equal(matchChannel('RE240229-1', CHANNELS, now)?.code, 'shipnity', 'leap day');
  assert.equal(matchChannel('RE260229-1', CHANNELS, now), null, 'not a leap year');
  // just after midnight Bangkok the new day counts, 23:30 UTC the day before is already the next Bangkok day
  assert.equal(matchChannel('RE261121-1', CHANNELS, Date.parse('2026-11-20T17:30:00Z'))?.code, 'shipnity');
  assert.equal(matchChannel('587229145958089832', CHANNELS, now)?.code, 'tiktok');
});
