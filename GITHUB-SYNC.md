# GitHub 與 Sites 版本對照

這是「競走動作分析」Sites 主版的獨立 GitHub 原始碼儲存庫。

- 基準版本：2.10.0
- Sites 原始碼提交：dd2207c4adc767f50aaf70a5c4b8c638066089dc
- 現有網站：https://racewalk-youzhen-lab.ifluit.chatgpt.site
- 舊版 alger68/racewalk-ai 保留，不作覆寫。
- 已整合播放幀率檢查、固定模型快取與資料品質診斷；未直接移植另一版本的接觸濾波與判讀門檻。
- 169 份原始文字檔案保留內容；大型二進位模型／WASM 由固定版本與 SHA-256 清單重建。
- 不含使用者影片、訓練報告、資料庫內容、環境變數或存取憑證。

## 取得 AI 模型

需要 Python 3 與可連接模型供應方的網路：

```sh
python3 scripts/restore-assets.py
python3 scripts/restore-assets.py --check
```

下載失敗或雜湊不同會明確報錯，不會使用替代模型。RTMPose 原始 ONNX 依現有網站相同位元組邊界分成兩份。各模型與執行元件授權見 public/models/MODELS.md 與 public/licenses。

## 安裝與驗證

使用 Node 22.13 以上及 package.json 鎖定的 pnpm 版本：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm exec tsc --noEmit
```

部署仍需要 README 所述的 Sites 身分閘道、D1 與 R2；GitHub Pages 無法直接取代這些後端服務。

## 同步規則

目前沒有設定背景雙向自動同步，也沒有把私人 Sites 憑證放入 GitHub。GitHub 提交不會自動發布現有網站。後續更新應先比對兩邊提交，完成測試，再同步程式及透過 Sites 發布；存在衝突時不得強制覆蓋。

source-manifest.json 可核對每份原始檔案是否與基準版本相同；它是匯入基準，後續程式修改需更新版本對照。
