# sample-web · 現代化高質感形象網站展示庫

[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare%20Pages-Zero--config-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![HTML5](https://img.shields.io/badge/HTML5-Semantic-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/CSS3-Glassmorphism%20%26%20Motion-1572B6?logo=css3&logoColor=white)](https://developer.mozilla.org/docs/Web/CSS)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-CDN-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![JavaScript](https://img.shields.io/badge/ES6%2B-Vanilla%20JS-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript)
[![A11y](https://img.shields.io/badge/A11y-WCAG%20minded-2EA44F)](https://www.w3.org/WAI/standards-guidelines/wcag/)
[![Static](https://img.shields.io/badge/Architecture-Pure%20Static-111827)](#技術架構)

> 一套以純靜態技術打造的三風格形象網站範例，推送至 Git 即可由 Cloudflare Pages 自動構建與發布，無需任何打包工具。

---

## 目錄

- [專案願景](#專案願景)
- [視覺設計概念](#視覺設計概念)
- [三種風格範例](#三種風格範例)
- [專案目錄架構](#專案目錄架構)
- [技術架構](#技術架構)
- [本地預覽](#本地預覽)
- [Cloudflare Pages 部署說明](#cloudflare-pages-部署說明)
- [頁面模組化指南](#頁面模組化指南)
- [色彩變數與自定義](#色彩變數與自定義)
- [圖片與版權說明](#圖片與版權說明)
- [品質檢核](#品質檢核)
- [已知限制與後續建議](#已知限制與後續建議)

---

## 專案願景

**讓形象網站回歸「內容與質感」本身。** 不需要複雜的框架、不需要後端伺服器，一個 Git 儲存庫即可交付三種截然不同的品牌氣質：

| 場景 | 氣質關鍵字 | 對應頁面 |
| --- | --- | --- |
| 企業接洽、SaaS、顧問服務 | 科技、精準、可信賴 | `business-style-01.html` |
| 個人品牌、生活美學、創作者 | 溫潤、留白、慢節奏 | `lifestyle-01.html` |
| 藝廊、精品、高端品牌 | 莊重、奢華、沉浸 | `elegant-style.html` |

## 視覺設計概念

- **Business · Tech Editorial**：深夜藍底（`#05060f`）搭配靛藍與青色光暈，玻璃擬態（Glassmorphism）卡片與發光邊框，參考 Stripe / Linear 的層次感。
- **Lifestyle · Nordic-Japanese Editorial**：紙白（`#f7f4ef`）與墨色（`#2b2a27`），以陶土色（`#b5835a`）與鼠尾草綠（`#8a9a7b`）點綴；襯線標題搭配無襯線內文，留白優先。
- **Elegant · Gallery Noir**：黑曜石（`#0b0b0d`）、象牙白（`#f4f1ea`）與香檳金（`#c9a961`）；全螢幕視差 Hero、金線分隔、時間軸與原生 Dialog 展品詳情。

## 三種風格範例

| # | 頁面 | 關鍵區塊 |
| --- | --- | --- |
| 0 | [`index.html`](index.html) | Showcase Hub：三個風格預覽卡片、特色標籤與直達按鈕 |
| 1 | [`business-style-01.html`](business-style-01.html) | Sticky 導航、Hero 與動態數據、服務卡片（Hover 狀態）、案例數據、客戶商標跑馬燈、評價、即時驗證表單、企業頁尾 |
| 2 | [`lifestyle-01.html`](lifestyle-01.html) | 極簡 Header、個人介紹與理念引言、精選日誌（閱讀時長與標籤）、靈感相簿（燈箱 + 鍵盤操作）、電子報訂閱、極簡頁尾 |
| 3 | [`elegant-style.html`](elegant-style.html) | 全螢幕沉浸 Hero（視差）、策展路線分頁（Tabs）、典藏精品卡片與 Modal 詳情、匠人傳承時間軸、貴賓預約表單 |

## 專案目錄架構

```text
sample-web/
├── index.html                  # 根目錄總覽入口（Showcase Hub）
├── business-style-01.html      # 風格 1：商務接洽與企業形象
├── lifestyle-01.html           # 風格 2：簡約個人網誌與品牌形象
├── elegant-style.html          # 風格 3：經典藝廊與沉浸式品牌
├── 404.html                    # 自訂 404 頁（Cloudflare Pages 自動使用）
├── _redirects                  # 大小寫別名與乾淨網址的 301 重新導向
├── README.md                   # 專案文件
└── assets/
    ├── css/
    │   └── site.css            # 共用設計 Token、玻璃擬態、動態與無障礙樣式
    ├── js/
    │   └── site.js             # 共用互動：選單、Reveal、表單驗證、Lightbox、Dialog、Tabs、Parallax
    └── images/                 # 原創 AI 生成圖與 SVG 作品（無版權疑慮）
        ├── biz-hero.jpg
        ├── life-hero.jpg
        ├── life-post-1.jpg ~ life-post-3.jpg
        ├── life-gallery-1.jpg ~ life-gallery-4.jpg
        ├── ele-hero.jpg
        └── ele-art-1.svg ~ ele-art-3.svg
```

## 技術架構

| 層級 | 選型 | 說明 |
| --- | --- | --- |
| 結構 | HTML5 | 使用 `header`、`nav`、`main`、`section`、`article`、`figure`、`dialog` 等語意標籤 |
| 樣式 | Tailwind CSS（Play CDN）+ `assets/css/site.css` | 原子化樣式負責排版與響應式；自訂 CSS 負責玻璃擬態、光暈、視差與動態 |
| 字體 | Google Fonts：Inter、Playfair Display、Noto Sans TC、Noto Serif TC | 以 `preconnect` + `display=swap` 優化載入 |
| 圖示 | Lucide Icons（UMD CDN，版本鎖定 `0.460.0`） | 以 `data-lucide` 屬性宣告 |
| 互動 | 原生 ES6+（無套件） | IntersectionObserver、`<dialog>`、WAI-ARIA Tabs 模式 |
| 部署 | Cloudflare Pages | 無構建指令，直接發布根目錄 |

## 本地預覽

任何靜態伺服器皆可，例如：

```bash
# 方法一：Python（內建）
python3 -m http.server 8080

# 方法二：Node.js
npx serve .
```

開啟 `http://localhost:8080` 即可預覽。（注意：Tailwind、Google Fonts 與 Lucide 需要網路才能載入。）

## Cloudflare Pages 部署說明

### 建立專案

1. 登入 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
2. 選擇本儲存庫與正式分支（例如 `main`）。
3. 依下表設定構建參數。

### Build settings

| 欄位 | 建議值 | 說明 |
| --- | --- | --- |
| Framework preset | `None` | 純靜態網站，不需框架 |
| Build command | *（留空）* | 不需要任何構建步驟 |
| Build output directory | `/`（或 `.`） | 直接發布儲存庫根目錄 |
| Root directory (advanced) | *（留空）* | 位於儲存庫根目錄 |
| Production branch | `main` | 推送至此分支即正式上線 |

### 環境配置建議

- **Preview 分支**：每個 Pull Request 會自動產生獨立預覽網址，適合審閱視覺變更。
- **自訂網域**：於 Pages 專案的 *Custom domains* 綁定網域，並確認 DNS 指向。
- **Headers（選用）**：可新增 `_headers` 檔案設定安全標頭，例如：

  ```text
  /*
    X-Content-Type-Options: nosniff
    Referrer-Policy: strict-origin-when-cross-origin
    Permissions-Policy: camera=(), microphone=(), geolocation=()
  ```

- **重新導向**：`_redirects` 已設定常見別名（例如 `/business` → `/business-style-01`），Pages 會自動套用。
- **URL 規範**：檔名統一採用全小寫加短橫線（kebab-case）。Pages 會自動省略 `.html` 副檔名，因此 `/lifestyle-01` 等同於 `lifestyle-01.html`。

## 頁面模組化指南

每個頁面都是獨立的 HTML 檔，但共用以下三個資源，修改一處即可全站生效：

1. **`assets/css/site.css`**：設計 Token（`:root` 變數）、`.glass`（玻璃擬態）、`.glow-card`（發光邊框）、`.btn-glow`（按鈕微互動）、`.reveal`（捲動淡入）、`.marquee`（跑馬燈）、`dialog.site-dialog`（Modal / Lightbox 外觀）。
2. **`assets/js/site.js`**：以 `data-*` 屬性啟用功能，不需修改程式碼：

   | 屬性 | 功能 |
   | --- | --- |
   | `data-nav-toggle` + `aria-controls` | 行動版選單（自動維護 `aria-expanded`） |
   | `data-header-scroll` | Header 捲動後加上 `.is-scrolled` 狀態 |
   | `.reveal` | 進入視窗時淡入上移 |
   | `form[data-validate]` + `data-error` | 即時表單驗證與錯誤訊息（需搭配 `id-error` 元素） |
   | `data-dialog-open="id"` / `data-dialog-close` | 開啟與關閉 `<dialog>` |
   | `data-lightbox-item` + `#lightbox` | 相簿燈箱，支援方向鍵與遮罩關閉 |
   | `[data-tabs]` + `role="tab"` | 分頁切換，支援左右方向鍵 |
   | `data-parallax="0.3"` | 視差位移（尊重 `prefers-reduced-motion`） |
   | `data-year` | 自動填入當年份 |

3. **Tailwind 設定**：每個頁面 `<head>` 內的 `tailwind.config` 可擴充字型與色票。

### 新增頁面的步驟

1. 複製任一現有頁面（例如 `lifestyle-01.html`）為新檔，檔名採用 `kebab-case`，如 `about-us.html`。
2. 保留 `<head>` 中的字型、Tailwind、`site.css`、`site.js` 引用。
3. 在 `index.html` 新增卡片連結，並於 `_redirects` 視需要新增別名。

### 表單的整合

目前表單僅做前端驗證並顯示成功訊息，**不會實際送出資料**。`site.js` 中「此處可接入後端」的註解位置即為接入點，可選擇：

- Cloudflare Pages Functions（`functions/` 目錄，免費額度內即可使用）
- Formspree、Google Forms 等第三方表單服務
- 自建 API

## 色彩變數與自定義

### 共用 CSS 變數（`assets/css/site.css`）

```css
:root {
  --c-biz-bg: #05060f;        /* 商務：深色背景 */
  --c-biz-brand: #6366f1;     /* 商務：品牌靛藍 */
  --c-biz-accent: #22d3ee;    /* 商務：強調青色 */
  --c-life-paper: #f7f4ef;    /* 生活：紙白底色 */
  --c-life-ink: #2b2a27;      /* 生活：墨色文字 */
  --c-life-terracotta: #b5835a; /* 生活：陶土點綴 */
  --c-life-sage: #8a9a7b;     /* 生活：鼠尾草綠 */
  --c-ele-obsidian: #0b0b0d;  /* 藝廊：黑曜石 */
  --c-ele-alabaster: #f4f1ea; /* 藝廊：象牙白 */
  --c-ele-gold: #c9a961;      /* 藝廊：香檳金 */
  --shadow-layered: ...;      /* 多層複合陰影 */
}
```

> 注意：Tailwind CDN 不會讀取 CSS 變數作為工具類別的值。若要全站換色，請同步修改各頁 `tailwind.config` 中的 `colors`（例如 `biz`、`paper`、`gold`）與 HTML 內的對應類別。

### 修改字型

在各頁 `<head>` 的 Google Fonts 連結與 `tailwind.config.theme.extend.fontFamily` 中同時替換即可。

## 圖片與版權說明

- 所有 JPG 圖片皆為 **AI 原創生成**，不含任何真人肖像、商標或既有著作，可自由用於商業與非商業用途（請依所在地法規與平台政策自行確認）。
- 藝廊「典藏作品」為原創 SVG 向量插圖，無版權疑慮。
- 所有公司名稱（Lumora、Aurelia Bank、Kestrel Logistics 等）、人名、案例數據與展品資訊**皆為虛構的展示用範例**，正式使用前請全數替換。
- 若要改用真實照片，建議來源：[Unsplash](https://unsplash.com/license)（Unsplash License）或 [Pexels](https://www.pexels.com/license/)，並於頁尾或致謝區標示來源。
- 所有圖片皆設定 `loading="lazy"`、`width`/`height` 屬性，並透過 `aspect-ratio` 類別與 `object-cover` 避免版面位移（CLS）。

## 品質檢核

| 項目 | 狀態 | 說明 |
| --- | --- | --- |
| 響應式 | ⚠️ 已依斷點設計，待實機驗證 | 以 Tailwind 斷點（`sm` 640px、`md` 768px、`lg` 1024px）對應 375px / 768px / 1440px+；建議以瀏覽器 DevTools 逐一確認 |
| 語意化 HTML | ✅ | `header`、`nav`、`main`、`section`、`article`、`figure`、`dl`、`dialog` |
| ARIA | ✅ | `aria-label`、`aria-expanded`、`aria-controls`、`aria-invalid`、`aria-describedby`、Tabs 與 `role="status"` |
| 鍵盤與焦點 | ✅ | `skip-link`、`:focus-visible` 樣式、Dialog 內建焦點管理、Tabs 左右鍵 |
| 動態偏好 | ✅ | `prefers-reduced-motion` 會停用跑馬燈、視差與 Reveal 動畫 |
| 死連結 | ✅ 已檢查 | 本地資源、圖片與頁內錨點已以腳本檢查；外部 CDN 無法在建置環境中連線驗證，請於部署後確認 |

## 已知限制與後續建議

- **外部 CDN 依賴**：Tailwind Play CDN 適合展示與快速原型，正式環境建議改為 Tailwind CLI 預先編譯 CSS 以減少執行期成本。
- **表單未串接後端**：見上方「表單的整合」。
- **內容為範例**：文案、數據與人物皆為虛構，請依品牌替換。
- **Lucide 版本鎖定**：若升級版本，請留意圖示名稱是否有異動。
- **後續可加強**：多語系（`hreflang`）、結構化資料（JSON-LD）、`sitemap.xml`、以及以 Lighthouse 進行效能與無障礙驗收。
