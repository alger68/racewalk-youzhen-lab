# RaceWalk 模型來源

影片只在本機瀏覽器做推論。下載模型不會把影片送到模型供應方。

| 模型 | 用途 | SHA-256 |
| --- | --- | --- |
| MediaPipe Full, float16 v1 | 主骨架 33 點 | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` |
| RTMPose-s WholeBody, 20230728 | 133 點輸出，核對對應軀幹／四肢／腳部 | `b791032a77010398f95b112f863dbe30ad16e09ff156753fb08484ff5bf8f718` |

- [MediaPipe Full 來源](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task)；[模型說明](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)。SDK 固定為 0.10.32。
- [RTMPose-s 官方 ONNX 匯出包](https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-s_simcc-ucoco_dw-ucoco_270e-256x192-3fd922c8_20230728.zip)；[專案模型表](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose)。採用包內 end2end.onnx，共 33,531,475 bytes；僅分成 20,971,520 與 12,559,955 bytes 兩段供靜態託管，載入後合併核對完整雜湊，未量化或改權重。
- RTMPose 預處理依包內 pipeline.json：192×256，bbox padding 1.25，RGB，mean [123.675,116.28,103.53]、std [58.395,57.12,57.375]，NCHW。輸出 simcc_x [1,133,384] 與 simcc_y [1,133,512]；argmax／2 還原座標。
- [COCO WholeBody 點位定義](https://github.com/open-mmlab/mmpose/blob/main/configs/_base_/datasets/coco_wholebody.py)：左右膝 13/14、踝 15/16、腳跟 19/22、大腳趾 17/20。腳趾與 MediaPipe foot-index 不視為完全相同的解剖位置，僅做腳部尺度的交叉核對。
- ONNX Runtime Web 1.22.0，WASM 單執行緒；搭配同版 `.mjs`、`.wasm`，未使用 WebGPU 或 WebGL。
- 既有 Lite 與 EfficientDet Lite0 檔案保留；新自動骨架分析不再使用 Lite。人物選擇保留 EfficientDet 補找候選。
- [MediaPipe 授權](../licenses/MediaPipe.txt)、[OpenMMLab 授權](../licenses/OpenMMLab.txt)、[ONNX Runtime 授權](../licenses/ONNX-Runtime.txt)。第三方模型與程式保留原始授權及作者聲明。

## 人物外觀辨識（2.9.0）

- [Ultralytics YOLO26n-ReID 官方 ONNX](https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n-reid.onnx)，9,873,245 bytes，SHA-256 `8529c383197ae4c468eda535d1b165f8b4162cf17bf5fbcff49c7cb6455bc0bb`。保留原始權重；模型 metadata：8.4.62、MSMT17-v1、2026-06-10。
- [官方編碼器程式](https://github.com/ultralytics/ultralytics/blob/main/ultralytics/trackers/utils/reid.py)；本版採動態 ONNX 路徑的 224×224 RGB、NCHW、除以 255，輸出 512 維後 L2 正規化。不是分類標籤，也不是人臉辨識。
- 模型原授權為 [AGPL-3.0](ULTRALYTICS-AGPL-3.0.txt)，保留作者及授權聲明；[上游原始碼](https://github.com/ultralytics/ultralytics)、[本網站程式原始碼](../source/racewalk-source.tar.gz)。第三方元件各依其原授權。
- 新增的多人短期記憶與互為唯一匹配為本專案實作，不宣稱已完整移植 BoT-SORT，也尚未加入相機運動補償或雙機三維重建。
- 外觀向量僅存在當次背景分析及頁面記憶體；不寫入報告或雲端。報告只記錄使用過 `appearance-reid-v1`。
