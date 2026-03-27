# Zero-G Ghost v6.5

**Zero-G Ghost** は、ブラウザの描画負荷を極限まで低減するために設計された、超軽量かつ強力なレンダリング最適化エンジンです。Google Chrome 拡張機能、およびモバイル対応のブックマークレットとして動作します。

## 📁 プロジェクト構造

```text
Zero-G-Ghost/
├── manifest.json         # 拡張機能のマニフェスト (V3)
├── content.js            # コア・エンジン (描画制御 & 遮蔽検知)
├── style.css             # エンジン用スタイル (content-visibility 定義)
├── zero-g-ghost.html     # ニュータブ UI (Y2K/Windows 2000 スタイル)
├── newtab.js             # ニュータブ用ロジック (キャッシュ削除・ナビゲーション)
├── guide.html            # ユーザーガイド & ブックマークレット配布ページ
├── icon16.png            # アイコン (16x16)
├── icon48.png            # アイコン (48x48)
└── icon128.png           # アイコン (128x128)
```

## ✨ 主な機能

1.  **Ghost Engine (Native Culling)**:
    - ブラウザ標準の `content-visibility: auto` を活用し、画面外の要素の描画処理を C++ 層で停止させます。
2.  **Z-Axis Analyzer (Occlusion Detection)**:
    - 画面内であっても、他の不透明な要素（ヘッダー、モーダル、動画のオーバーレイ等）に完全に隠れている要素を検知し、非表示化 (`content-visibility: hidden`) します。
3.  **Flicker Prevention (Size Freezing)**:
    - 要素を非表示にする直前にそのサイズを固定することで、無限スクロールやグリッドレイアウトでのガタつき（レイアウトシフト）を防止します。
4.  **Infinite Scroll Optimization**:
    - DOM の変更を監視し、新しく追加された画像や Iframe に対して自動的に `loading="lazy"` を注入します。
5.  **Y2K Aesthetic Newtab**:
    - Windows 2000 スタイルの軽量なニュータブ画面を提供。強力なキャッシュ・インデックス DB 削除機能を搭載しています。

## 🛠️ 技術詳細・主要関数

### `content.js` (コア・エンジン)

- **`freezeSize(el)` / `unfreezeSize(el)`**:
  - 要素を隠す直前に `offsetWidth/Height` を取得し、`style` 属性に直接書き込みます。これにより、要素が「幽霊化」しても周囲のレイアウトが崩れません。
- **`runScan()` (Z-Axis Analyzer)**:
  - `elementsFromPoint` を使用して、対象要素の 5 つのサンプリングポイント上に「自分より Z 軸が上で、かつ不透明な要素」が存在するかを判定します。
  - CPU 負荷を抑えるため、`requestIdleCallback` を利用して非同期に実行されます。
- **`intersectionObserver`**:
  - `rootMargin: '400px'` を設定し、画面外に出た要素を `zg-hidden` クラスで即座に非表示化します。
- **`mutationObserver`**:
  - ページ内の要素追加を検知し、即座に Ghost エンジンの監視対象として登録。同時に `loading="lazy"` を注入してネットワーク負荷も最適化します。

### `newtab.js` (ニュータブ・ロジック)

- **`startCacheClear()`**:
  - `chrome.browsingData` API を使用。キャッシュ、Service Workers、IndexedDB、フォームデータを一括削除します。
  - 削除実行中は Y2K スタイルのアニメーション（ファイルがゴミ箱へ飛ぶ演出）を表示します。

## 🚀 導入方法

1.  `chrome://extensions` を開く。
2.  「デベロッパーモード」を ON にする。
3.  「パッケージ化されていない拡張機能を読み込む」から `Zero-G-Ghost` フォルダを選択。

---
© 2026 Zero-G Ghost Project. Optimized for the Modern Web.
