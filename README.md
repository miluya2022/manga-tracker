# 追漫書架（PWA + Userscript + Supabase）

免安裝漫畫閱讀 App，在瀏覽器看漫畫櫃（`m.manhuagui.com` / `www.manhuagui.com`）時自動背景紀錄**看到哪一話、哪一頁**，隨時從手機主畫面的 PWA 書架一鍵續看。

## 專案結構

- `supabase/schema.sql`：Supabase 資料表、RLS 與 RPC 函式
- `userscript/manga-tracker.user.js`：瀏覽器自動同步腳本
- `pwa/`：純靜態 PWA 網頁（免建置，直接部署即可）

---

## 快速啟用（3 步驟）

### 步驟 1：建立 Supabase 資料表與 RPC
1. 打開你的 Supabase Dashboard → **SQL Editor**。
2. 貼上 `supabase/schema.sql` 全部內容並點 **Run**。
3. 到 **Project Settings → API** 記下：
   - **Project URL**（`https://xxxxx.supabase.co`）
   - **anon public key**

> 安全設計：資料表已開啟 RLS 且不允許匿名直接讀寫，所有查詢與寫入都透過 RPC 驗證你自訂的 `sync_key`。

### 步驟 2：部署 PWA 並設定連線
`pwa/` 是純靜態網頁，任選一種免費託管即可（支援 HTTPS 才能加到主畫面）：
- **Cloudflare Pages / Netlify Drop**：直接把整個 `pwa/` 資料夾拖拉上傳即可取得網址。
- **GitHub Pages**：推送到 repo 後將 Pages 來源指向 `pwa/`。
- **本機測試**：在 `pwa/` 目錄執行 `npx serve .` 或 `python3 -m http.server 8080`。

打開 PWA 網址後：
1. 點右上角 **⚙ 設定**，填入 **Supabase URL** 與 **Anon Key**。
2. 點 **隨機產生** 建立一組個人 **Sync Key**，按 **儲存並連線**。
3. 點下方 **複製** 取得整理好的 `CONFIG` 區塊。
4. 在手機瀏覽器點 **「加入主畫面」**，就能像 App 一樣使用。

### 步驟 3：安裝瀏覽器自動同步腳本（Userscript）
依照你平常看漫畫的裝置安裝腳本管理器，新增腳本並貼上 `userscript/manga-tracker.user.js`，把開頭的 `CONFIG` 換成剛才複製的內容：

- **iPhone / iPad（Safari）**：App Store 安裝免費的 **Userscripts** 擴充功能，在 iOS「設定 → Safari → 延伸功能」開啟並允許存取 `manhuagui.com`。
- **Mac / Windows（Chrome / Edge / Safari / Firefox）**：安裝 **Tampermonkey** 或 **Violentmonkey**。
- **Android**：使用 **Firefox**、**Edge** 或 **Kiwi Browser** 安裝 Tampermonkey / Violentmonkey。

---

## 使用方式

1. 照常在瀏覽器打開漫畫櫃（例如 `https://m.manhuagui.com/comic/53094/`）開始看漫畫。
2. 翻頁或切換話數後約 1.2 秒，右下角會短暫浮現 `✓ 已同步 第XX話 P.X`（不影響閱讀）。
3. 下次要看時打開手機主畫面的 **追漫書架 PWA**，點「續看」或封面即可直接跳回上次停住的那一話與頁碼。
