import type { CSSProperties } from "react";

/**
 * 写真を枠にどう収めるか。管理画面の「位置を変更」「枠に収める」で決める。
 *
 * 保存する値は `"<横>% <縦>% <倍率>"`（倍率は省略可＝等倍）。例 `"50% 30%"` / `"40% 20% 1.6"`。
 * 1つの文字列なので、JSONの項目にも本文のMarkdown（画像のタイトル欄）にも同じ形で入る。
 *
 * 等倍は object-position だけ。拡大は「枠より大きい箱に cover で入れて、はみ出しを枠で隠す」形にする。
 * 箱を 倍率×枠 にして、見せたい割合ぶん左上へずらす（横0%で左端・100%で右端）。
 */
export type Crop = { x: number; y: number; z: number };

export function parseCrop(v?: string | null): Crop | null {
  const m = /^\s*([\d.]+)%\s+([\d.]+)%(?:\s+([\d.]+))?\s*$/.exec(String(v ?? ""));
  if (!m) return null;
  return { x: +m[1], y: +m[2], z: m[3] ? +m[3] : 1 };
}

/** img に当てる style。値が無ければ undefined（従来どおりの中央基準） */
export function cropStyle(v?: string | null): CSSProperties | undefined {
  const c = parseCrop(v);
  if (!c) return undefined;
  const base: CSSProperties = { objectPosition: `${c.x}% ${c.y}%` };
  if (c.z <= 1) return base;
  const r = (n: number) => Math.round(n * 100) / 100; // 端数で長い数値が出力に残らないように
  return {
    ...base,
    position: "absolute",
    // Tailwind の preflight（img { max-width: 100%; height: auto }）に負けないように解除する。
    // 解除しないと幅だけ100%に頭打ちになり、右側が黒く空く（2026-09-14 ジムフィールドのHYROXヘッダーで発覚）
    maxWidth: "none",
    maxHeight: "none",
    width: `${r(c.z * 100)}%`,
    height: `${r(c.z * 100)}%`,
    left: `${r(-(c.z - 1) * c.x)}%`,
    top: `${r(-(c.z - 1) * c.y)}%`,
  };
}

/** 同じものをHTML文字列用に（本文のMarkdownから作った img に差し込む） */
export function cropStyleText(v?: string | null): string {
  const st = cropStyle(v);
  if (!st) return "";
  return Object.entries(st)
    .map(([k, val]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${val}`)
    .join(";");
}
