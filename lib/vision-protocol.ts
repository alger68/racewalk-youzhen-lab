import type { Point } from "./racewalk";
export const MAX_POSES=12;
export type ModelKind="pose"|"people";
export type PixelFrame={width:number;height:number;data:Uint8ClampedArray};
export type RawPose={landmarks:Point[][]};
export type RawPeople={detections:{boundingBox:{originX:number;originY:number;width:number;height:number};score:number}[]};
export type VisionRequest={id:number}&({command:"init";kind:ModelKind;baseUrl:string}|{command:"detect";images:PixelFrame[]});
