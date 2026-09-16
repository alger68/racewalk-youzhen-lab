import { bilateralInspection } from './inspection';
import { targetFrames, type Report } from './racewalk';
export type Diagnostic={title:string;action:string;time?:number};
export function analysisDiagnostics(r:Report):Diagnostic[]{
 const out:Diagnostic[]=[],frames=targetFrames(r).filter(f=>f.t>=r.settings.start&&f.t<=r.settings.end);
 if(!frames.length)return [{title:'尚未取得分析資料',action:'先圈選一位選手並開始分析；空白結果不代表動作正常。'}];
 const missing=frames.filter(f=>!!f.reason||f.track?.state==='searching'||f.track?.state==='lost');
 if(missing.length)out.push({title:`身分或骨架未確認：${missing.length}／${frames.length} 格`,action:'回看首次缺值處；確認追蹤框仍指向原選手。遮擋期間保留未知。',time:missing[0].t});
 for(const side of bilateralInspection(r))if(side.role!=='unavailable'&&side.valid<side.total){
  const first=side.samples.find(p=>p.value===null);
  out.push({title:`${side.side==='L'?'左':'右'}膝可用 ${side.valid}／${side.total} 格`,action:side.reasons[0]?.reason??'核對鏡位與關節清晰度；有效比例不是準確率。',time:first?.t});
 }
 if(!r.settings.timingVerified)out.push({title:'實際時間尚未確認',action:'核對拍攝 fps 與慢放倍率後，才使用步頻與毫秒結果。'});
 if(!r.settings.ground||!r.settings.groundStable||!r.settings.clearFeet)out.push({title:'接觸分析條件未完成',action:'標記地面並核對鞋底及整段地面有效性；追拍影片不能假設固定地面線。'});
 if(!out.length)out.push({title:'基本分析條件已具備',action:'仍需回看原片與關鍵幀；這不是動作合格或準確率保證。'});
 return out;
}
