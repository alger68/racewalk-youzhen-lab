import type { Point, PoseFrame, Report, Side } from "./racewalk";
import { RECOVERY_PENDING, type LimbConfirmation } from "./limb-quality";

/** Delayed acceptance of an actually observed sample, never interpolation.
 * The caller supplies only the immediately preceding decoded frame. Identity
 * gaps, rejected joints, manual edits and an unconfirmed final frame stay put. */
export function confirmObservedPrevious(previous:PoseFrame,current:PoseFrame,confirmations:LimbConfirmation[],slow:number):PoseFrame {
 const a=previous.track,b=current.track,dt=(current.t-previous.t)/slow;
 if(!a||!b||a.state!=="locked"||b.state!=="locked"||a.targetId!==b.targetId||a.continuity!==b.continuity||previous.manual||current.manual||!previous.exact||!current.exact||previous.reason||current.reason||dt<=0||dt>.2)return previous;
 let result=previous;
 for(const confirmation of confirmations){
  const {side,t,points}=confirmation,core=side==="L"?[23,25,27]:[24,26,28],all=[...core,core[0]+6,core[0]+8];
  if(t!==previous.t||a.withheld?.[side]!==RECOVERY_PENDING||b.withheld?.[side]||points.length!==33||!core.every(i=>points[i].v>=.65&&a.verification?.compared.includes(i)&&!a.verification.rejected.includes(i)&&current.points[i]?.v>=.65&&b.verification?.compared.includes(i)))continue;
  const withheld={...result.track!.withheld};delete withheld[side];
  result={...result,points:result.points.map((p,i)=>all.includes(i)&&a.verification!.compared.includes(i)&&!a.verification!.rejected.includes(i)?{...points[i]}:p),track:{...result.track!,withheld:Object.keys(withheld).length?withheld:undefined,recovered:{...result.track!.recovered,[side]:{confirmedAt:current.t}}}};
 }
 if(result!==previous)result.track!.note=Object.entries(result.track!.withheld??{}).map(([s,r])=>`${s==="L"?"左":"右"}腳：${r}`).join("；")||"已由下一格確認原始關節點位；未插值或補造角度。";
 return result;
}

// A manual correction supersedes the automatic evidence for those three
// joints. If it edits the next-frame witness, invalidate only the affected
// preceding delayed measurement, retaining the other leg and all identity gaps.
export function manuallyCorrectKnee(report:Report,t:number,side:Side,coordinates:Point[]):Report{
 const index=report.frames.findIndex(f=>Math.abs(f.t-t)<.0001),f=report.frames[index],start=side==="L"?23:24,ids=[start,start+2,start+4];
 if(!f||f.track?.state!=="locked"||f.track.targetId!==report.settings.target?.id||f.reason||f.points.length!==33||coordinates.length!==3||coordinates.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1))throw new Error("請在目前目標的有效影格標記三個關節。");
 const points=f.points.map((p,i)=>ids.includes(i)?{...coordinates[ids.indexOf(i)],v:1}:p),withheld={...f.track.withheld},recovered={...f.track.recovered};
 delete withheld[side];delete recovered[side];
 const v=f.track.verification,filter=(values:number[]|undefined)=>values?.filter(i=>!ids.includes(i));
 const verification=v?{...v,compared:filter(v.compared)!,rejected:filter(v.rejected)!,unobserved:filter(v.unobserved),conflicts:filter(v.conflicts),...(v.retry?{retry:{...v.retry,recovered:filter(v.retry.recovered)!}}:{})}:undefined;
 const frames=[...report.frames];frames[index]={...f,points,manual:true,track:{...f.track,withheld:Object.keys(withheld).length?withheld:undefined,recovered:Object.keys(recovered).length?recovered:undefined,verification,note:"含人工標點；未修正的低可信點位仍不取值。"}};
 const previous=frames[index-1];
 if(previous?.track?.recovered?.[side]?.confirmedAt===f.t){
  const history={...previous.track.recovered};delete history[side];
  const all=[...ids,start+6,start+8];
  frames[index-1]={...previous,points:previous.points.map((p,i)=>all.includes(i)?{...p,v:0}:p),track:{...previous.track,recovered:Object.keys(history).length?history:undefined,withheld:{...previous.track.withheld,[side]:"相鄰確認幀已人工修改，請重新複核"},note:"相鄰確認幀已人工修改，相關自動恢復量測已撤回。"}};
 }
 return {...report,frames};
}
