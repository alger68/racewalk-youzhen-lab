import { normalizedEmbedding } from "./person-memory";
export const REID_SIZE=224;
export const REID_SHA="8529c383197ae4c468eda535d1b165f8b4162cf17bf5fbcff49c7cb6455bc0bb";
export function reidTensor(rgba:Uint8ClampedArray):Float32Array {
 const area=REID_SIZE*REID_SIZE;if(rgba.length!==area*4)throw new Error("外觀影格尺寸不正確");
 const out=new Float32Array(area*3);
 for(let i=0;i<area;i++)for(let channel=0;channel<3;channel++)out[channel*area+i]=rgba[4*i+channel]/255;
 return out;
}
export function reidEmbedding(values:ArrayLike<number>){
 const result=normalizedEmbedding(values);if(!result)throw new Error("人物外觀模型回覆無效");return result;
}
