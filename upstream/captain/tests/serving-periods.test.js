const test=require('node:test'),assert=require('node:assert/strict');
const {describe}=require('../assets/common/serving-periods');
const product={serving_time_zone:'Asia/Kolkata',serving_periods:[{name:'Breakfast',hours:{wed:[{open:420,close:660}]}},{name:'Late dinner',hours:{tue:[{open:1080,close:120}]}}]};
test('suggestions follow branch time and close at the exact boundary',()=>{
 assert.equal(describe(product,new Date('2026-09-30T03:00:00Z'))[0].active,true);
 assert.equal(describe(product,new Date('2026-09-30T05:30:00Z'))[0].active,false);
});
test('overnight periods include yesterday and invalid zones never guess',()=>{
 assert.equal(describe(product,new Date('2026-09-29T19:00:00Z'))[1].active,true);
 assert.equal(describe({...product,serving_time_zone:'invalid'},new Date())[0].active,false);
 assert.equal(describe({...product,serving_time_zone:''},new Date())[0].active,false);
});
test('missing serving facts leave the ordinary menu unchanged',()=>assert.deepEqual(describe({}),[]));
