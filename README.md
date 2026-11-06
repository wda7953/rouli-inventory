# 柔力進銷存

柔力工作室自己的器材零售管理 PWA（與歐赫斯五品牌進銷存各自獨立）。

## 功能
- **器材目錄**：定價(售價)／成本(進價)／一般售價／安信大家庭，並算毛利；可新增/編輯/刪除器材。
- **新增銷售**：選客戶 → 從目錄挑品項（自動帶建議價）→ 改數量/單價 → 送出。
- **客戶紀錄**：各客戶累計收款、每單買了什麼、可刪單。

## 架構
- 純靜態 PWA（GitHub Pages）＋ Google Apps Script Web App ＋ Google Sheet 後端。
- 與 expense-app / body-tracker 同一套路：token 認證、client_id 去重、LockService。

## 資料表（Google Sheet 自動建立兩分頁）
- `catalog`：id, name, category, list(定價), cost(成本), normal(一般售價), anxin(安信大家庭), note
- `sales`：sale_id, date, customer, item, qty, unit_price, subtotal, note, client_id

## 部署步驟
1. 建一份新的 Google Sheet（名稱隨意，例「柔力進銷存」）。
2. 該 Sheet →「擴充功能 → Apps Script」，把 `apps-script.gs` 全部貼上；再新增一個檔案把 `seed.gs` 貼上（seed.gs 含客戶名字與成本，不在 GitHub，從本機資料夾開）。
3. 在編輯器選函式 `seedCatalog` 執行（授權），再選 `seedSales` 執行 → 灌入 PDF 資料。
4. 設密碼：在 `seed.gs` 把 `setPassword()` 裡的字串改成你要的密碼，執行一次（存進 Script Properties）。
5. 右上「部署 → 新增部署作業 → 類型選 網頁應用程式」，執行身分=我、存取權=任何人，部署取得網址。
   - 存取權「任何人」只是讓前端連得到；真正的門鎖是上面設的密碼（後端驗、不在前端原始碼）。
6. 把網址貼進 `js/api.js` 的 `API_URL`，push。
7. GitHub repo → Settings → Pages → 來源 main 分支，網址即 `https://wda7953.github.io/rouli-inventory/`。

## 安全模型
- 前端是公開靜態頁，但一開啟要輸入密碼才看得到資料。
- 密碼存在後端 Script Properties，不進 git、不寫在前端；後端每次請求都驗，錯的直接擋。
- `API_TOKEN` 只是擋機器人的第一層；真正的鎖是使用者密碼。

## 待補 / 待核對
- 月熊是客戶，但無確定購買明細（非整批買第 1 頁、第 5 頁 LOTUS 無收款金額），暫未列入 seed。
- 順哥資料遺失，忽略。
