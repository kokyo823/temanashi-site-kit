# temanashi-site-kit

テマナシCMS（cms.temanashi.co）に接続する店舗サイト（Next.js）の**共通部品**。
サイトごとにコピーして持つと修正が横展開されない（2026-09-14 杉山指摘）ので、ここを正本にして各サイトは依存で取り込む。

| 入口 | 何をするか |
|---|---|
| `temanashi-site-kit/crop` | `parseCrop` / `cropStyle` / `cropStyleText`。CMSの「トリミング」値 `"x% y% z"` を img の style にする。拡大時は `max-width/max-height: none` を含む（Tailwind preflight 対策） |
| `temanashi-site-kit/CropImg` | 枠つきの写真。`aspect-[4/3] w-full` などを枠に、写真は枠いっぱいに敷き、`focus` を反映する。`cmsPath` / `cmsFocusPath` でプレビュー連動の目印が付く |
| `temanashi-site-kit/CmsPreviewBridge` | 下書きサイトに1つ置く。ポータルのプレビュー iframe と連動（ハイライト・クリックで項目へ・**保存前の内容を即時反映**） |

## 使い方

```bash
npm i github:kokyo823/temanashi-site-kit#v0.1.0
```

`next.config.mjs`（.ts/.tsx をそのまま配布しているので transpile 指定が要る）:

```js
const nextConfig = { transpilePackages: ["temanashi-site-kit"] };
```

```tsx
import { cropStyle } from "temanashi-site-kit/crop";
import CropImg from "temanashi-site-kit/CropImg";
import CmsPreviewBridge from "temanashi-site-kit/CmsPreviewBridge";

// layout.tsx（下書きサイトだけでよい。本番に置いても埋め込み時以外は何もしない）
<CmsPreviewBridge />

// 枠つき写真（CMSの項目 race.photos[0].img / .focus を即時プレビューに載せる）
<CropImg src={p.img} alt={p.cap} focus={p.focus} className="aspect-[4/3] w-full" cmsPath="race.photos.0.img" cmsFocusPath="race.photos.0.focus" />

// 生の img に当てる
<img src={hero.img} style={{ objectPosition: "50% 30%", ...(cropStyle(hero.imgFocus) || {}) }} data-cms-img="hero.img" data-cms-focus="hero.imgFocus" />
```

## プレビュー連動の目印

- `data-cms="<path>"` … 項目を触ったときのハイライト・クリックでフォームへ（従来どおり）
- `data-cms-img="<path>"` … 保存前の写真の差し替え
- `data-cms-focus="<path>"` … 保存前のトリミング
- `data-cms-text="<path>"` … 保存前の文章（textContent を差し替え）

`<path>` はサイト編集フォームのデータパス（例 `race.stations.3.img`）。

## 更新の流れ

1. ここを直してタグを打つ（`v0.1.x`）
2. 各サイトの `package.json` のタグを上げて `npm i` → ビルド → main へ
