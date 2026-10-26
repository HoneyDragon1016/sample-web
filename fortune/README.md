# 東京淺草觀音寺百籤

獨立的純靜態網站資料夾，放在本儲存庫的 `fortune/` 路徑；Cloudflare Pages 直接發布儲存庫根目錄時，首頁網址路徑為 `/fortune/index.html`。不需要建置指令或額外套件。

- 首頁：`index.html`
- 100 支籤頁：`lots/001/index.html` 至 `lots/100/index.html`
- 共用樣式與抽籤互動：`assets/`
- 籤詩資料：`data/fortunes.json`
- 本機預覽：在儲存庫根目錄執行 `python3 -m http.server 8080`，再開啟 `/fortune/index.html`。

籤詩原文依提供的 PDF 整理並保留；各籤解讀重新撰寫，供文化與生活參考，不代替專業醫療、法律或財務建議。
