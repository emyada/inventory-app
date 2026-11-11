import {test} from 'node:test';
import assert from 'node:assert/strict';
import {numericOrderKey,orderIdentityKey,duplicateIssueDecision,duplicateOrderWarning} from './duplicateOrderPolicy.js';
import {workflowError} from './inventoryWorkflow.js';
const request={request_id:'new',order_ref:'ZG0001',parent_category:'reviewed-parent',category:'CIEM',work_kind:'primary'};
const prior={...request,request_id:'old',order_ref:'PN1',issued_at:'2026-10-01T17:00:00Z'};
test('approved unsupported fallback preserves punctuation, letters and numeric distinction',()=>{
 assert.equal(orderIdentityKey(' Job-001 '),'text:job-001');
 assert.notEqual(orderIdentityKey('Job-001'),orderIdentityKey('Z001'));
 assert.notEqual(orderIdentityKey('Job-001'),orderIdentityKey('Job001'));
 assert.equal(duplicateIssueDecision({...request,order_ref:' Job-001 '},[{...prior,order_ref:'job-001'}]).status,'duplicate');
 assert.equal(duplicateIssueDecision({...request,order_ref:'Job-001'},[{...prior,order_ref:'Job-001',issued_at:null}]).status,'allowed');
});
test('supported numeric prefixes, leading zeros and arbitrary precision; unknown formats not guessed',()=>{
 for(const value of ['Z0001','ZG1','PL01','PN1','0001',' zg0001 '])assert.equal(numericOrderKey(value),'1');
 assert.equal(numericOrderKey('PN99999999999999999999999'),'99999999999999999999999');
 for(const value of ['AB1','Z1-2','PN-1','1.2','customer 1',null,''])assert.equal(numericOrderKey(value),null);
});
test('same parent blocks; unrelated parent allows same numeric reference',()=>{
 assert.equal(duplicateIssueDecision(request,[prior]).status,'duplicate');
 assert.equal(duplicateIssueDecision({...request,parent_category:'unrelated'},[prior]).status,'allowed');
});
test('drafts are not issues; same request continuation allowed; cancelled issued history still evidence',()=>{
 assert.equal(duplicateIssueDecision(request,[{...prior,issued_at:null}]).status,'allowed');
 assert.equal(duplicateIssueDecision({...request,request_id:'old'},[prior]).reason,'existing_request');
 assert.equal(duplicateIssueDecision(request,[{...prior,cancelled:true}]).status,'duplicate');
});
test('Package only allowed with exact explicit relationship; primary-primary and supplemental-supplemental denied',()=>{
 const pkg={...request,work_kind:'supplemental'};
 assert.equal(duplicateIssueDecision(pkg,[prior]).status,'relationship_required');
 assert.equal(duplicateIssueDecision(pkg,[prior],{relationships:[{primary_request_id:'old',supplemental_request_id:'new',parent_category:'reviewed-parent'}]}).status,'allowed');
 assert.equal(duplicateIssueDecision(pkg,[{...prior,work_kind:'supplemental'}],{relationships:[{primary_request_id:'primary',supplemental_request_id:'new',parent_category:'reviewed-parent'}]}).status,'duplicate');
 assert.equal(duplicateIssueDecision(request,[prior],{relationships:[{primary_request_id:'old',supplemental_request_id:'new',parent_category:'reviewed-parent'}]}).status,'duplicate');
});
test('package never inferred from matching numbers; explicit relationship required even without an issued primary',()=>{
 assert.equal(duplicateIssueDecision({...request,work_kind:'supplemental'},[]).status,'relationship_required');
 assert.equal(duplicateIssueDecision({...request,work_kind:'supplemental'},[],{relationships:[{primary_request_id:'new',supplemental_request_id:'new',parent_category:'reviewed-parent'}]}).status,'relationship_required');
});
test('Sleepplug variants use configured parent not model names',()=>{
 assert.equal(duplicateIssueDecision({...request,category:'Sleepplug',model_name:'Sleepplug Glow'},[{...prior,category:'Sleepplug',model_name:'Sleepplug'}]).status,'duplicate');
});
test('only verified exact Repair category exempt; no inferred aliases',()=>{
 assert.equal(duplicateIssueDecision({...request,category:'ซ่อมและอื่นๆ'},[prior]).reason,'existing_repair_exception');
 assert.equal(duplicateIssueDecision({...request,category:'Repair'},[prior]).status,'duplicate');
 assert.equal(duplicateIssueDecision({...request,parent_category:null},[]).status,'needs_review');
});
test('structured warning includes evidence safely, malformed detail does not leak arbitrary JSON',()=>{
 const error={message:'DUPLICATE_ORDER_ISSUED',details:JSON.stringify({previous_order_ref:'PN0001',issued_at:prior.issued_at,issuer_name:'ทดสอบ'})};
 assert.match(workflowError(error),/PN0001/);assert.match(workflowError(error),/ทดสอบ/);
 assert.ok(duplicateOrderWarning({...error,details:'invalid'}));assert.equal(duplicateOrderWarning({message:'unrelated'}),null);
});
