import type { CSSProperties } from "react";
import { cropStyle } from "./crop";

/**
 * 枠つきの写真。テマナシCMSの「位置を変更」「拡大」（focus 値 "x% y% z"）をそのまま反映する。
 *
 * 拡大（z>1）は img を枠より大きく絶対配置して、はみ出しを枠で隠す方式（lib/crop.ts）。
 * そのため img 単体に aspect-[] を付ける従来の書き方では拡大が効かない。枠（div）に比率とサイズを持たせ、
 * img は枠いっぱいに敷く。focus が無ければ従来どおり中央基準の object-cover。
 */
export default function CropImg({
  src,
  alt,
  focus,
  className = "",
  imgClassName = "",
  imgStyle,
  loading = "lazy",
  cmsPath,
  cmsFocusPath,
}: {
  src: string;
  alt: string;
  focus?: string | null;
  /** 枠のクラス（aspect-[4/3] w-full など） */
  className?: string;
  /** img に足すクラス（v2-ph・grayscale など） */
  imgClassName?: string;
  /** img に足すスタイル（filter 等。focus の style と合成する） */
  imgStyle?: CSSProperties;
  loading?: "lazy" | "eager";
  /** ポータルのプレビュー連動（CmsPreviewBridge）。サイト編集フォームの項目パス（例 race.photos.0.img） */
  cmsPath?: string;
  cmsFocusPath?: string;
}) {
  return (
    <span className={`relative block overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={loading}
        className={`absolute inset-0 h-full w-full object-cover ${imgClassName}`}
        style={{ ...(imgStyle || {}), ...(cropStyle(focus) || {}) }}
        data-cms-img={cmsPath}
        data-cms-focus={cmsFocusPath}
      />
    </span>
  );
}
