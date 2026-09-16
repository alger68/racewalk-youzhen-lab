const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash,webcrypto}=require('node:crypto');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const {sha256Portable}=require('../.qa/browser-crypto.js');
test('portable SHA256 matches known vectors and padding boundaries',()=>{
 for(const n of [0,1,3,55,56,63,64,65,1000,1000000]){
  const bytes=Uint8Array.from({length:n},(_,i)=>i%251);
  assert.equal(sha256Portable(bytes),createHash('sha256').update(bytes).digest('hex'));
 }
 assert.equal(sha256Portable(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('UUID and file hash retain identity without secure-context convenience APIs',async()=>{
 const exports={};vm.runInNewContext(readFileSync('.qa/browser-crypto.js','utf8'),{exports,crypto:{getRandomValues:a=>webcrypto.getRandomValues(a)},Uint8Array,Uint32Array,DataView});
 const ids=new Set();for(let i=0;i<100;i++){const id=exports.randomId();assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);ids.add(id);}assert.equal(ids.size,100);
 assert.equal(await exports.fileHash({arrayBuffer:async()=>new TextEncoder().encode('abc').buffer}),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
