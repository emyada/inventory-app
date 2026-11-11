import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inventoryEnvironmentPolicy} from './inventoryEnvironment.js';

test('preview label is explicit without relabeling local or enabling writes',()=>{
 for(const [name,label] of [['preview','PREVIEW'],['local','LOCAL'],['staging','STAGING'],['production','PRODUCTION']]){
  const policy=inventoryEnvironmentPolicy({VITE_INVENTORY_V2_ENABLED:'true',VITE_INVENTORY_ENVIRONMENT:name});
  assert.equal(policy.banner,`${label} — READ ONLY`);assert.equal(policy.mutationsEnabled,false);
 }
});
test('scrollable notices and controls stay before the persistent navigation',()=>{
 const source=readFileSync('src/views/InventoryV2.jsx','utf8');
 const content=source.indexOf('<div className="inv-content">'),nav=source.indexOf('<nav className="inv-bottom"');
 for(const marker of ['<ManagedAccounts','<RequestPolicySwitch','{setupError&&','<InventoryRecoveryPanel']){
  assert.ok(source.indexOf(marker)>content);assert.ok(source.indexOf(marker)<nav);
 }
 assert.match(source,/aria-label="เมนูหลัก"/);
 assert.doesNotMatch(source,/รอการตรวจนับยอดตั้งต้น/);
});
test('unconfigured legacy Sheets action is absent',()=>{
 assert.doesNotMatch(readFileSync('src/components/InventoryReports.jsx','utf8'),/เปิด Google Sheet/);
});
