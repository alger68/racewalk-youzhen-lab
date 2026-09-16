const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createLocalReportStore}=require('../.qa/local-report-store.js');
const {defaults}=require('../.qa/racewalk.js');

function memoryStorage(){
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
function report(id='one',version=0){return {schema:1,engine:'test',id,version,created:'2026-09-16T00:00:00.000Z',settings:defaults(),file:{name:'clip.mov',size:4,duration:1,width:100,height:100,sha256:'a'.repeat(64)},frames:[],events:[],judge:{contact:'pending',left:'pending',right:'pending'},notes:'',complete:false};}

test('local report store saves versioned reports and returns newest first',()=>{
 const store=createLocalReportStore(memoryStorage());
 const first=store.save(report('one'));
 assert.equal(first.version,1);
 const second=store.save({...first,notes:'changed'});
 assert.equal(second.version,2);
 store.save({...report('two'),created:'2026-09-17T00:00:00.000Z'});
 assert.deepEqual(store.list().map(r=>r.id),['two','one']);
 assert.equal(store.open('one').notes,'changed');
});

test('local report store rejects corruption and deletes only the requested report',()=>{
 const storage=memoryStorage(),store=createLocalReportStore(storage);
 store.save(report('one'));store.save(report('two'));
 store.remove('one');
 assert.equal(store.open('one'),null);assert.equal(store.open('two').id,'two');
 storage.setItem('racewalk-local-reports-v1','not-json');
 assert.deepEqual(store.list(),[]);
});
