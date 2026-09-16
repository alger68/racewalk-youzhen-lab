import type { Report } from './racewalk';

type StorageLike={getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void};
const KEY='racewalk-local-reports-v1';

export function createLocalReportStore(storage:StorageLike){
 const read=():Report[]=>{
  try{const value=JSON.parse(storage.getItem(KEY)??'[]');return Array.isArray(value)?value:[];}catch{return [];}
 };
 const write=(reports:Report[])=>storage.setItem(KEY,JSON.stringify(reports));
 return {
  list:()=>read().sort((a,b)=>b.created.localeCompare(a.created)),
  open:(id:string)=>read().find(report=>report.id===id)??null,
  save:(report:Report)=>{const reports=read(),current=reports.find(item=>item.id===report.id);const saved={...report,version:(current?.version??0)+1};write([saved,...reports.filter(item=>item.id!==report.id)]);return saved;},
  remove:(id:string)=>write(read().filter(report=>report.id!==id)),
 };
}
