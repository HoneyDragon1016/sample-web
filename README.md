# sample-web · 現代化高質感形象網站展示庫

[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare%20Pages-Zero--config-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![HTML5](https://img.shields.io/badge/HTML5-Semantic-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/CSS3-Glassmorphism%20%26%20Motion-1572B6?logo=css3&logoColor=white)](https://developer.mozilla.org/docs/Web/CSS)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-CDN-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![JavaScript](https://img.shields.io/badge/ES6%2B-Vanilla%20JS-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/docs/Web/JavaScript)
[![A11y](https://img.shields.io/badge/A11y-WCAG%20minded-2EA44F)](https://www.w3.org/WAI/standards-guidelines/wcag/)
[![Static](https://img.shields.io/badge/Architecture-Pure%20Static-111827)](#技術架構)

> 一套以純靜態技術打造的十一款形象網站範例，推送至 Git 即可由 Cloudflare Pages 自動構建與發布，無需任何打包工具。

---

## 目錄

- [專案願景](#專案願景)
- [視覺設計概念](#視覺設計概念)
- [十一款頁面特色對照總覽](#十一款頁面特色對照總覽)
- [Cockpit Racer 3D 遊戲架構指南](#cockpit-racer-3d-遊戲架構指南)
- [專案目錄架構](#專案目錄架構)
- [技術架構](#技術架構)
- [動態引擎架構指南](#動態引擎架構指南)
- [本地預覽](#本地預覽)
- [Cloudflare Pages 部署說明](#cloudflare-pages-部署說明)
- [頁面模組化指南](#頁面模組化指南)
- [色彩變數與自定義](#色彩變數與自定義)
- [圖片與版權說明](#圖片與版權說明)
- [品質檢核](#品質檢核)
- [已知限制與後續建議](#已知限制與後續建議)

---

## 專案願景

**讓形象網站回歸「內容與質感」本身。** 不需要複雜的框架、不需要後端伺服器，一個 Git 儲存庫即可交付十種截然不同的品牌氣質：

| 場景 | 氣質關鍵字 | 對應頁面 |
| --- | --- | --- |
| 企業接洽、SaaS、顧問服務 | 科技、精準、可信賴 | `business-style-01.html` |
| 個人品牌、生活美學、創作者 | 溫潤、留白、慢節奏 | `lifestyle-01.html` |
| 藝廊、精品、高端品牌 | 莊重、奢華、沉浸 | `elegant-style.html` |
| 旗艦單品、DTC 電商發售 | 科技工藝、規格導向、轉換導向 | `ProductLaunch01.html` |
| 創意設計工作室、新創品牌 | 大膽、活潑、強烈個性 | `CreativeStudio01.html` |
| 米其林餐飲、精品旅宿 | 典雅、微醺、沉浸式體驗 | `CulinaryExperience01.html` |
| 科技敘事、產品解構、深度專題 | 電影感、捲動敘事、空間感 | `SpatialStory01.html` |
| 先鋒數位創意工作室 | 賽博、動態排版、強烈互動 | `KineticAgency01.html` |
| 微互動展示、互動實驗、產品手感 | 流體、物理、多感官回饋 | `InteractivePlayground01.html` |
| 賽車品牌、賽道活動、車隊介紹 | 競速、數據、霓虹酸綠 | `RaceDay01.html` |
| 第一人稱 3D 賽車遊戲、沉浸式競速 | 駕駛艙、WebGL、即時渲染 | `RaceCockpit01.html` |

## 視覺設計概念

- **Business · Tech Editorial**：深夜藍底（`#05060f`）搭配靛藍與青色光暈，玻璃擬態（Glassmorphism）卡片與發光邊框，參考 Stripe / Linear 的層次感。
- **Lifestyle · Nordic-Japanese Editorial**：紙白（`#f7f4ef`）與墨色（`#2b2a27`），以陶土色（`#b5835a`）與鼠尾草綠（`#8a9a7b`）點綴；襯線標題搭配無襯線內文，留白優先。
- **Elegant · Gallery Noir**：黑曜石（`#0b0b0d`）、象牙白（`#f4f1ea`）與香檳金（`#c9a961`）；全螢幕視差 Hero、金線分隔、時間軸與原生 Dialog 展品詳情。
- **Product · Obsidian Tech**：黑曜石（`#0a0b0f`）、冰白與青色光暈；全螢幕產品 Hero、Bento 規格網格、互動熱點與吸底購買列。
- **Studio · Neo-Brutalism**：鮮黃（`#facc15`）、紫（`#a855f7`）、薄荷綠（`#6ee7b7`）搭配深黑線條；粗線框、硬陰影、跑馬燈與瀑布流案例。
- **Culinary · Fine Dining**：炭黑（`#141210`）、暖木色（`#8b5a2b`）與琥珀金（`#c9a36a`）；沉浸式 Hero、主廚哲理、互動菜單與席位預訂。
- **Spatial · Deep Scroll Story**：深空黑（`#05060a`）與青/橘能量光暈；釘選式 360° 解構、SVG 路徑繪製、文字遮罩擦除與深度儀表板。
- **Kinetic · Cyber Neon**：賽博黑（`#07060d`）搭霓虹粉（`#ff2d78`）、電光藍（`#00e0ff`）與酸性綠（`#d9ff3f`）；磁吸游標、橫向展廊與 Kinetic Type。
- **Lab · Fluid Playground**：實驗室黑（`#06060c`）與紫/粉/青流體光暈；3D 傾斜流光、Canvas 粒子場、物理拖曳與 Web Audio 微聲效。
- **Race · Apex GP**：柏油黑（`#080b0c`）、霓虹酸綠（`#d8ff3e`）與賽道光影；互動賽道切換、SVG 路線圖、遙測數值模擬與車手名單。
- **Cockpit Racer · 第一人稱駕駛艙**：延續 Apex GP 酸綠識別；黃金時刻天空、程序化賽道地景、碳纖維駕駛艙與電影級後製（徑向速度模糊、色差、暗角、膠片顆粒）。

## 十一款頁面特色對照總覽

| # | 頁面 | 分類 | 動效技術 | 關鍵區塊 |
| --- | --- | --- | --- | --- |
| 0 | [`index.html`](index.html) | — | Vanilla JS Filter | 風格矩陣 Hub：分類篩選器、10 款預覽卡片、技術標籤與直達按鈕 |
| 1 | [`business-style-01.html`](business-style-01.html) | 商業形象 | CSS Transition | Sticky 導航、Hero 與動態數據、服務卡片（Hover 狀態）、案例數據、客戶商標跑馬燈、評價、即時驗證表單、企業頁尾 |
| 2 | [`lifestyle-01.html`](lifestyle-01.html) | 品牌生活 | CSS + Lightbox | 極簡 Header、個人介紹與理念引言、精選日誌（閱讀時長與標籤）、靈感相簿（燈箱 + 鍵盤操作）、電子報訂閱、極簡頁尾 |
| 3 | [`elegant-style.html`](elegant-style.html) | 奢華體驗 | Parallax + Modal | 全螢幕沉浸 Hero（視差）、策展路線分頁（Tabs）、典藏精品卡片與 Modal 詳情、匠人傳承時間軸、貴賓預約表單 |
| 4 | [`ProductLaunch01.html`](ProductLaunch01.html) | 商業形象 | IO + Sticky Bar | 全螢幕產品 Hero、核心規格 Bento Grid、互動 Feature Hotspots、媒體評測引言、吸底懸浮購買列 |
| 5 | [`CreativeStudio01.html`](CreativeStudio01.html) | 品牌生活 | CSS Hard Shadow | 搞怪 Hero Slogan、精選專案瀑布流（Hover 位移縮放）、拍立得團隊卡片、趣味報價計算機 |
| 6 | [`CulinaryExperience01.html`](CulinaryExperience01.html) | 奢華體驗 | Tabs + Parallax | 沉浸式氛圍 Hero、主廚哲理、互動美饌菜單（Tabs + 過敏原）、線上席位預訂、位置與私人包廂 |
| 7 | [`SpatialStory01.html`](SpatialStory01.html) | 動效互動 | **Lenis + GSAP Pin & Scrub** | 釘選式 360° 空間解構（分層爆發 + 數據飛入）、SVG 路徑動態繪製、文字遮罩擦除、章節深度儀表板 |
| 8 | [`KineticAgency01.html`](KineticAgency01.html) | 動效互動 | **Lenis + GSAP + Magnetic Cursor** | 磁吸自定義游標（延遲外環 + 差值反色 + 提示字）、橫向滾動視差展廊（containerAnimation）、字元波浪抖動、Kinetic Marquee |
| 9 | [`InteractivePlayground01.html`](InteractivePlayground01.html) | 動效互動 | **Lenis + GSAP + Canvas + Web Audio** | 3D 傾斜流光卡（Specular Glare）、Canvas 粒子場（點擊衝擊波）、慣性物理拖曳（邊界回彈）、Web Audio 微晶片聲效 |
| 10 | [`RaceDay01.html`](RaceDay01.html) | 賽車體驗 | **Vanilla JS + SVG** | 賽道即時切換、賽事數據儀表板、可啟停遙測模擬、車手陣容與響應式賽車 Hero |
| 11 | [`RaceCockpit01.html`](RaceCockpit01.html) | 賽車體驗（可玩 3D 遊戲） | **Three.js / WebGL2 + Web Audio + 自訂後製 Shader** | 第一人稱駕駛艙（Halo 安全環、聯動方向盤與換檔燈、雙後視鏡即時反射）、程序化賽道與地景、街機物理與漂移、3 台 AI 對手、圈速計時與小地圖、合成引擎聲浪 |

## 專案目錄架構

```text
sample-web/
├── index.html                  # 根目錄總覽入口（Showcase Hub）
├── business-style-01.html      # 風格 1：商務接洽與企業形象
├── lifestyle-01.html           # 風格 2：簡約個人網誌與品牌形象
├── elegant-style.html          # 風格 3：經典藝廊與沉浸式品牌
├── ProductLaunch01.html        # 風格 4：旗艦單品與 DTC 電商發售
├── CreativeStudio01.html       # 風格 5：新野蠻主義創意設計工作室
├── CulinaryExperience01.html   # 風格 6：米其林星級餐飲與精品旅宿
├── SpatialStory01.html         # 風格 7：沉浸式滾動敘事與空間解構（動效）
├── KineticAgency01.html        # 風格 8：動態排版與賽博感先鋒設計（動效）
├── InteractivePlayground01.html # 風格 9：微互動實驗室與流體物理場（動效）
├── RaceDay01.html              # 風格 10：APEX GP 賽道日與互動賽車遙測
├── RaceCockpit01.html          # 風格 11：APEX GP 第一人稱駕駛艙 3D 賽車（可玩遊戲）
├── 404.html                    # 自訂 404 頁（Cloudflare Pages 自動使用）
├── _redirects                  # 大小寫別名與乾淨網址的 301 重新導向
├── README.md                   # 專案文件
└── assets/
    ├── css/
    │   └── site.css            # 共用設計 Token、玻璃擬態、動態與無障礙樣式
    ├── js/
    │   ├── site.js             # 共用互動：選單、Reveal、表單驗證、Lightbox、Dialog、Tabs、Parallax
    │   ├── motion-engine.js    # 動態引擎：Lenis × GSAP ScrollTrigger 同步核心（動效頁共用）
    │   └── race-cockpit.js     # Cockpit Racer：第一人稱 3D 賽車遊戲引擎（ES Module）
    ├── vendor/
    │   └── three.module.min.js # Three.js r160（本地 vendor、MIT 授權，無外部 CDN 相依）
    └── images/                 # 原創 AI 生成圖與 SVG 作品（無版權疑慮）
        ├── biz-hero.jpg
        ├── life-hero.jpg
        ├── life-post-1.jpg ~ life-post-3.jpg
        ├── life-gallery-1.jpg ~ life-gallery-4.jpg
        ├── ele-hero.jpg
        ├── ele-art-1.svg ~ ele-art-3.svg
        ├── product-hero.jpg      # ProductLaunch01 產品主視覺
        ├── studio-hero.jpg       # CreativeStudio01 創意視覺
        ├── culinary-hero.jpg     # CulinaryExperience01 餐廳氛圍
        ├── spatial-hero.jpg      # SpatialStory01 機械核心主視覺
        ├── kinetic-hero.jpg      # KineticAgency01 賽博排版視覺
        ├── playground-hero.jpg   # InteractivePlayground01 流體粒子視覺
        ├── apex-hero.jpg         # RaceDay01 賽車主視覺
        └── cockpit-hero.jpg      # RaceCockpit01 第一人稱駕駛艙主視覺
```

## 技術架構

| 層級 | 選型 | 說明 |
| --- | --- | --- |
| 結構 | HTML5 | 使用 `header`、`nav`、`main`、`section`、`article`、`figure`、`dialog` 等語意標籤 |
| 樣式 | Tailwind CSS（Play CDN）+ `assets/css/site.css` | 原子化樣式負責排版與響應式；自訂 CSS 負責玻璃擬態、光暈、視差與動態 |
| 字體 | Google Fonts：Inter、Playfair Display、Noto Sans TC、Noto Serif TC | 以 `preconnect` + `display=swap` 優化載入 |
| 圖示 | Lucide Icons（UMD CDN，版本鎖定 `0.460.0`） | 以 `data-lucide` 屬性宣告 |
| 互動 | 原生 ES6+（無套件） | IntersectionObserver、`<dialog>`、WAI-ARIA Tabs 模式 |
| 動效引擎（動效頁） | Lenis 1.x + GSAP 3.12.5 + ScrollTrigger | 平滑滾動與捲動觸發動畫，以 `motion-engine.js` 統一同步，見[動態引擎架構指南](#動態引擎架構指南) |
| 3D 遊戲引擎（Cockpit Racer） | Three.js r160（本地 vendor）+ Web Audio + WebGL2 | 第一人稱駕駛艙賽車遊戲，見 [Cockpit Racer 3D 遊戲架構指南](#cockpit-racer-3d-遊戲架構指南) |
| 部署 | Cloudflare Pages | 無構建指令，直接發布根目錄 |

## 動態引擎架構指南

> 適用頁面：`SpatialStory01.html`、`KineticAgency01.html`、`InteractivePlayground01.html`
> 動效技術棧：**Lenis 1.x**（平滑滾動）＋ **GSAP 3.12.5 / ScrollTrigger**（捲動觸發動效），皆以 CDN 引入，維持 Cloudflare Pages 零配置構建。

### 整合原理：為什麼是 Lenis × ScrollTrigger？

平滑滾動引擎與捲動動畫引擎各自監聽 scroll 事件時，會產生「相位差」——畫面滾動位置與動畫進度不同步，造成抖動與掉幀。整合的關鍵是**讓兩者共用同一份座標系與同一個 rAF 迴圈**，由 `assets/js/motion-engine.js` 一次完成：

```js
// 1. 建立 Lenis 實例（平滑滾動）
const lenis = new Lenis({ duration: 1.15, smoothWheel: true });

// 2. 關鍵同步：Lenis 每次捲動 → 通知 ScrollTrigger 重算進度
lenis.on('scroll', ScrollTrigger.update);

// 3. 關鍵同步：由 gsap.ticker 驅動 Lenis 渲染（單一 rAF，杜絕掉幀）
gsap.ticker.add((time) => {
  lenis.raf(time * 1000);   // gsap.ticker 單位為秒，Lenis 為毫秒
});

// 4. 關閉 lag smoothing：捲動跟手、不做補間平滑
gsap.ticker.lagSmoothing(0);
```

`motion-engine.js` 另外封裝了：

| 機制 | 說明 |
| --- | --- |
| Resize 防抖重算 | `resize` 後 200ms 呼叫 `lenis.resize()` + `ScrollTrigger.refresh()`，確保 Pin / Scrub 座標正確 |
| 錨點平滑捲動 | 攔截 `a[href^="#"]`，改以 `lenis.scrollTo()`（無 Lenis 時降級原生 `scrollTo`） |
| 減少動態偏好 | `prefers-reduced-motion: reduce` 時完全停用 Lenis，回退原生捲動 |
| 觸控裝置降級 | `(pointer: coarse)` 停用平滑捲動與磁吸游標，行動端捲動維持原生順滑 |
| `onScrollProgress()` | 以 `ScrollTrigger.create` 回傳整頁捲動進度（供深度儀表板等 HUD 使用） |

### 效能優化配置

| 規範 | 實作 |
| --- | --- |
| 硬體加速 | 所有動畫僅使用 `transform`（`translate3d` / `scale` / `rotate`）與 `opacity`，全部落在合成層，零 Layout 重排 |
| 單一 rAF | GSAP ticker 同時驅動 Lenis、粒子場與拖曳物理，避免多個 `requestAnimationFrame` 爭搶 |
| 低延遲補間 | 磁吸游標、3D 傾斜採 `gsap.quickTo()` / `gsap.quickSetter()` 直寫 transform，繞過一般 tween 的排程成本 |
| 捲動事件 | 一律 `{ passive: true }`；進度回饋以 `ScrollTrigger.update` 取代手寫 scroll 監聽 |
| Pin & Scrub | `scrub: 1` 加入輕微平滑、`invalidateOnRefresh: true` 讓函式值（如 `end: '+=2600'`）在 resize 時重算 |
| 橫向展廊視差 | 以 `containerAnimation` 將次級 ScrollTrigger 掛在橫向 tween 上，避免自寫座標換算 |
| 視覺效果濾鏡 | SVG 發光以 `feGaussianBlur` 靜態濾鏡，避免動畫中每幀重算 |
| Canvas 粒子場 | `devicePixelRatio` 上限 2、`document.hidden` 時暫停 rAF、減少動態偏好時僅繪製靜態一幀 |
| Web Audio | 懶建立 `AudioContext`（需使用者手勢），振盪器 30–50ms 極短包絡後自動釋放，無音訊檔案載入 |
| Resize | 防抖 200ms → `ScrollTrigger.refresh()` 重算所有 Pin / Trigger 座標 |

### 動效頁的 Script 載入順序

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
<script src="https://unpkg.com/lenis@1/dist/lenis.min.js"></script>
<script src="assets/js/motion-engine.js"></script>   <!-- 讀取三者後初始化同步 -->
<script src="assets/js/site.js"></script>            <!-- 既有共用互動 -->
<script>/* 各頁動效腳本：MotionEngine.init() 後註冊 */</script>
```

> **容錯設計**：所有動效腳本皆以 `if (!window.gsap) return;` 守衛，CDN 載入失敗時頁面維持靜態可讀；初始隱藏狀態一律由 JS（`gsap.from` / `gsap.set`）建立，未載入 GSAP 時內容不會被 CSS 藏住。

## Cockpit Racer 3D 遊戲架構指南

> 適用頁面：`RaceCockpit01.html`（引擎：`assets/js/race-cockpit.js`）
> 一個在瀏覽器即時渲染、可直接遊玩的第一人稱賽車遊戲，維持純靜態部署（無構建步驟）。

### 技術棧選型

| 模組 | 選型 | 說明 |
| --- | --- | --- |
| 3D 渲染 | Three.js r160（`assets/vendor/three.module.min.js`，MIT） | 使用相對路徑載入本地 vendor，不受外部 CDN 影響 |
| 賽道生成 | 極座標閉合 CatmullRom 樣條 | 半徑函數疊加多個正弦項，保證封閉且不自我交疊；取樣 1000 點建立中心線、切線、法線與曲率 |
| 賽道幾何 | 自訂帶狀 BufferGeometry | 柏油路面、路緣石（僅彎道）、起跑線；紋理全部以 Canvas 程序化生成，零圖片請求 |
| 場景物件 | InstancedMesh | 護欄、輪胎堆、樹木以實例化繪製，單一 Draw Call 容納數百物件 |
| 街機物理 | 自寫 2D 平面模型 | 油門／煞車／轉向Authority 隨速衰減、橫向抓地力指數衰減（手煞車低抓地＝漂移）、草地減速、護欄碰撞消能 |
| AI 對手 | 樣條導航 + 曲率預覽 | 建置期以 `v = √(aLat/k)` 加剎車可行性反向平滑，預先計算全場彎道極速；即時名次以「越線次數 + 取樣進度」排序 |
| 音效 | Web Audio 程序化合成 | 三振盪器引擎聲（轉速联动音高與濾波）、噪音進氣／風噪／胎噪、碰撞合成；無任何音訊檔案 |
| 後製特效 | 單一全螢幕 Shader Pass | 徑向速度模糊、色差、暗角、碰撞紅閃、膠片顆粒；WebGL2 下 RT 啟用 4x MSAA |
| 後視鏡 | 低解析度 RenderTarget（256×64，隔幀更新） | 回望相機即時渲染場景，鏡面材質共用同一張 RT |

### 效能與可靠性設計

| 規範 | 實作 |
| --- | --- |
| 畫質分級 | 高畫質（後製 + 鏡面反射 + MSAA + 460 棵樹）／效能模式（直渲染 + 靜態鏡面 + 180 棵樹）；依 `pointer: coarse`、CPU 核心數與記憶體自動預設 |
| 像素比上限 | 高畫質 1.75、效能模式 1.0，避免 4K 行動裝置爆量 |
| 單一 rAF | 物理、AI、HUD、音效參數與渲染共用一個 `requestAnimationFrame` 迴圈 |
| HUD 節流 | DOM 更新每 3 幀一次；Canvas 儀表（轉速／時速）以 CanvasTexture 同步節流 |
| 自動暫停 | `visibilitychange` 時自動暫停比賽並 `suspend()` AudioContext |
| 動態偏好 | `prefers-reduced-motion` 停用鏡頭晃動、震動與膠片顆粒，遊戲仍可完整遊玩 |
| WebGL 偵測 | 無 WebGL 時顯示降級說明頁而非白屏 |
| 觸控適配 | `(pointer: coarse)` 自動顯示觸控 UI（拖曳轉向 + GAS/BRAKE） |
| 手把支援 | Gamepad API 標準映射（左軸轉向、RT/LT 油門煞車、A 手煞車） |

### 操作方式

- **鍵盤**：`W`/`↑` 油門、`S`/`↓` 煞車、`A` `D`/`←` `→` 轉向、`Space` 手煞車漂移、`Esc` 暫停
- **手把**：左類比軸轉向、RT 油門、LT 煞車、A 手煞車
- **觸控**：左半螢幕拖曳轉向、右下 GAS/BRAKE 按鈕

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
| 動態偏好 | ✅ | `prefers-reduced-motion` 停用 Lenis、跑馬燈、視差、粒子動畫與 Reveal；內容保持靜態可讀；Cockpit Racer 停用鏡頭晃動與顆粒 |
| 動效引擎同步 | ✅ | Lenis `scroll` → `ScrollTrigger.update`；`gsap.ticker` 驅動 `lenis.raf`；`lagSmoothing(0)` |
| 觸控裝置適配 | ✅ | `(pointer: coarse)` 自動停用磁吸游標與 3D 傾斜、回退原生捲動，行動端滾動順滑 |
| Resize 重算 | ✅ | 防抖 200ms 後呼叫 `lenis.resize()` + `ScrollTrigger.refresh()`，Pin / Scrub 座標自動重算 |
| Console Errors | ✅ | 全部動效腳本以 `if (!window.gsap)` 等守衛包覆，CDN 失敗優雅降級；Canvas / Audio 例外安全；Cockpit Racer 初始化失敗時顯示降級頁而非白屏 |
| 3D 遊戲邏輯 | ✅ | 賽道生成（無自我交疊）、帶狀幾何索引完整性、越線計圈與 AI 名次邏輯皆以 Node.js 對出貨代碼執行單元驗證通過 |
| 死連結 | ✅ 已檢查 | 本地資源、圖片與頁內錨點已以腳本檢查；外部 CDN 無法在建置環境中連線驗證，請於部署後確認 |

## 已知限制與後續建議

- **外部 CDN 依賴**：Tailwind Play CDN 適合展示與快速原型，正式環境建議改為 Tailwind CLI 預先編譯 CSS 以減少執行期成本；動效頁另依賴 GSAP（cdnjs）與 Lenis（unpkg）CDN，離線環境需自備檔案。Cockpit Racer 的 Three.js 已改為本地 vendor（`assets/vendor/`），無此問題。
- **表單未串接後端**：見上方「表單的整合」。
- **內容為範例**：文案、數據與人物皆為虛構，請依品牌替換。
- **Lucide 版本鎖定**：若升級版本，請留意圖示名稱是否有異動。
- **後續可加強**：多語系（`hreflang`）、結構化資料（JSON-LD）、`sitemap.xml`、以及以 Lighthouse 進行效能與無障礙驗收。
