"use client";

import { useEffect } from "react";
import { cropStyle } from "./crop";
import { applyImageChanges, applyTextChanges, collectChanges, findElementByText } from "./previewText";

/**
 * ポータル（サイト編集）のプレビュー連動ブリッジ。**下書きサイトだけ**に載る（layout.tsx で出し分け）。
 *
 * できること（ポータルのiframeに埋め込まれているときだけ有効）:
 *  1. ポータル→サイト: postMessage {type:"cms-highlight", key} を受けて、
 *     data-cms="<key>" の要素へスクロール＋青枠ハイライト
 *  2. サイト→ポータル: data-cms 要素のクリックで {type:"cms-select", key} を親へ送る
 *     （ポータル側がフォームの該当項目へスクロール＋フォーカスする）。ホバーで点線枠＝クリックできる合図
 *
 *  3. ポータル→サイト: {type:"cms-preview", data} で**保存前のフォーム内容**を受け、
 *     data-cms-img / data-cms-focus / data-cms-text の目印がある要素だけ差し替える（2026-09-13）。
 *     静的サイトなので保存→再ビルドを待たずに、写真の差し替え・トリミング・文章の変更が右のプレビューに出る。
 *     ページの再読み込みで消える一時的な上書き（本物の保存は「保存する」）。
 *
 *  4. ポータル→サイト: {type:"cms-preview", base, data, collection?} で**目印なし**の差し替え（2026-09-15・v0.2.0）。
 *     base＝保存済みの内容、data＝今の入力。変わった文字列をページの文字から探して置き換え、画像は src で差し替える
 *     （previewText.ts）。店舗・広告LPのような一覧の1件も、サイト側に目印を付けずに即時プレビューできる。
 *     結果（構造の変更・見つからなかった件数）を {type:"cms-preview-result"} で親へ返し、ポータルが案内を出す。
 *     collection 付き（一覧の1件）のときは、設定用の目印（data-cms-img 等の絶対パス）には当てない。
 *     cms-highlight も目印が無ければ text（今の入力）→ alt（保存済み）の順でページの文字から探す。
 */
const ALLOWED_ORIGINS = [
  "https://cms.temanashi.co", // 2026-09-04〜 テマナシCMS（Cloudflare Workers）
  "https://fitin-cms-mcp.vercel.app",
  "http://localhost:8930", // cms-mcp のローカル動作確認（scripts/local-serve.mjs）
];


/** Lenis（SmoothScroll）稼働中は素のscrollIntoViewがrafと衝突して手前で止まるため、Lenis経由で寄せる */
function scrollToEl(el: HTMLElement) {
  type LenisLike = { scrollTo: (t: HTMLElement, o?: { offset?: number; duration?: number }) => void };
  const lenis = (window as unknown as { __lenis?: LenisLike }).__lenis;
  // 要素をだいたい画面中央に（大きい要素はヘッダー72px＋余白ぶんだけ上を空ける）
  const margin = Math.max(96, (window.innerHeight - el.getBoundingClientRect().height) / 2);
  if (lenis?.scrollTo) {
    lenis.scrollTo(el, { offset: -margin, duration: 0.8 });
  } else {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export default function CmsPreviewBridge() {
  useEffect(() => {
    const embedded = window.parent !== window;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    let lastEl: HTMLElement | null = null;

    const clearHighlight = () => {
      if (lastEl) {
        lastEl.style.outline = "";
        lastEl.style.outlineOffset = "";
        lastEl = null;
      }
    };

    /** フォーム内容を目印つき要素へ重ねる。値が無い（空欄）ものは触らない */
    const applyPreview = (data: unknown) => {
      const flat = new Map<string, unknown>();
      const walk = (v: unknown, p: string) => {
        if (Array.isArray(v)) v.forEach((x, i) => walk(x, p ? `${p}.${i}` : String(i)));
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, p ? `${p}.${k}` : k);
        else flat.set(p, v);
      };
      walk(data, "");
      const restore = (el: HTMLElement) => {
        if (el.dataset.cmsOrigStyle == null) el.dataset.cmsOrigStyle = el.getAttribute("style") || "";
        el.setAttribute("style", el.dataset.cmsOrigStyle);
      };
      for (const img of document.querySelectorAll<HTMLImageElement>("[data-cms-img]")) {
        const key = img.dataset.cmsImg || "";
        if (flat.has(key)) {
          const v = flat.get(key);
          if (typeof v === "string" && v.trim()) img.src = v.trim();
        }
        const fk = img.dataset.cmsFocus || "";
        if (fk && flat.has(fk)) {
          restore(img);
          const st = cropStyle(String(flat.get(fk) ?? ""));
          if (st) Object.assign(img.style, st as Record<string, string>);
        }
      }
      for (const el of document.querySelectorAll<HTMLElement>("[data-cms-text]")) {
        const key = el.dataset.cmsText || "";
        if (!flat.has(key)) continue;
        const v = flat.get(key);
        if (typeof v === "string") el.textContent = v;
      }
    };

    // 目印なし差し替え（4）の最新の内容。React の再描画で要素が作り直されたら当て直す
    let generic: { base: unknown; data: unknown } | null = null;
    const runGeneric = () => {
      if (!generic) return null;
      const ch = collectChanges(generic.base, generic.data);
      const t = applyTextChanges(document.body, ch.texts);
      const imgMiss = applyImageChanges(document, ch.images);
      return {
        structural: ch.structural,
        changed: ch.texts.length + ch.images.length,
        unmatched: t.unmatched.length + imgMiss.length,
        samples: [...t.unmatched, ...imgMiss].slice(0, 3).map((p) => p[0].slice(0, 40)),
      };
    };
    let moTimer: ReturnType<typeof setTimeout> | null = null;
    const mo = new MutationObserver(() => {
      if (!generic) return;
      if (moTimer) clearTimeout(moTimer);
      moTimer = setTimeout(runGeneric, 120);
    });

    const onMessage = (e: MessageEvent) => {
      if (!ALLOWED_ORIGINS.includes(e.origin)) return;
      const data = e.data as { type?: string; key?: string; path?: string; text?: string; alt?: string; data?: unknown; base?: unknown; collection?: string };
      if (data?.type === "cms-preview") {
        if (!data.collection) applyPreview(data.data);
        if (data.base !== undefined && data.base !== null) {
          if (!generic) mo.observe(document.body, { childList: true, subtree: true });
          generic = { base: data.base, data: data.data };
          const result = runGeneric();
          (e.source as Window | null)?.postMessage({ type: "cms-preview-result", ...result }, e.origin);
        }
        return;
      }
      if (data?.type !== "cms-highlight" || !(data.key || data.path || data.text)) return;
      // path（例 race.stations.2.desc）を優先し、目印が無ければ末尾の階層を削って親セクションへフォールバック
      let el: HTMLElement | null = null;
      const segs = data.path || data.key ? String(data.path || data.key).split(".") : [];
      while (segs.length && !el) {
        el = document.querySelector<HTMLElement>(`[data-cms="${CSS.escape(segs.join("."))}"]`);
        if (!el) segs.pop();
      }
      // 目印の無いサイト・一覧の1件は、触っている項目の文字をページから探す（v0.2.0）
      if (!el && data.text) el = findElementByText(document.body, data.text);
      if (!el && data.alt) el = findElementByText(document.body, data.alt);
      if (!el) return;
      clearHighlight();
      if (clearTimer) clearTimeout(clearTimer);
      scrollToEl(el);
      el.style.outline = "3px solid #2E8BFF";
      el.style.outlineOffset = "6px";
      lastEl = el;
      clearTimer = setTimeout(clearHighlight, 2500);
    };

    // サイト→ポータル（クリックで編集項目を選ぶ）。埋め込まれているときだけ＝通常閲覧の邪魔をしない
    const onClick = (e: MouseEvent) => {
      if (!embedded) return;
      const el = (e.target as HTMLElement | null)?.closest?.("[data-cms]") as HTMLElement | null;
      if (el) {
        e.preventDefault();
        e.stopPropagation();
        const path = el.getAttribute("data-cms") || "";
        // key=トップレベル項目（旧ポータル互換）・path=細かい該当箇所
        window.parent.postMessage({ type: "cms-select", key: path.split(".")[0], path }, "*");
        return;
      }
      // 目印の外のリンクは replace で遷移＝プレビュー内の移動が親（ポータル）の戻る履歴を汚さない
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && !a.target && a.href.startsWith(location.origin)) {
        e.preventDefault();
        const url = new URL(a.href);
        url.searchParams.set("cmspreview", "1"); // プレビュー状態を遷移先でも維持
        location.replace(url.toString());
      }
    };

    // 埋め込み時はリロード（プレビュー更新）をまたいでスクロール位置を保つ
    if (embedded) {
      const key = `cmsScroll:${location.pathname}`;
      const saved = sessionStorage.getItem(key);
      if (saved) {
        // Lenis初期化前に一度、初期化後にもう一度合わせる（rafによる巻き戻り対策）
        requestAnimationFrame(() => window.scrollTo(0, Number(saved)));
        setTimeout(() => {
          const l = (window as unknown as { __lenis?: { scrollTo: (y: number, o?: { immediate?: boolean }) => void } }).__lenis;
          if (l) l.scrollTo(Number(saved), { immediate: true });
        }, 400);
      }
      window.addEventListener("pagehide", () => sessionStorage.setItem(key, String(window.scrollY)));
    }
    const onOver = (e: MouseEvent) => {
      if (!embedded) return;
      const el = (e.target as HTMLElement | null)?.closest?.("[data-cms]") as HTMLElement | null;
      if (!el || el === lastEl) return;
      el.style.outline = "2px dashed rgba(46,139,255,.6)";
      el.style.outlineOffset = "4px";
      el.style.cursor = "pointer";
    };
    const onOut = (e: MouseEvent) => {
      if (!embedded) return;
      const el = (e.target as HTMLElement | null)?.closest?.("[data-cms]") as HTMLElement | null;
      if (!el || el === lastEl) return;
      el.style.outline = "";
      el.style.outlineOffset = "";
      el.style.cursor = "";
    };

    window.addEventListener("message", onMessage);
    // 埋め込み時: 読み込みが済んだことを親（ポータル）へ知らせ、保存前のフォーム内容を送ってもらう
    if (embedded) window.parent.postMessage({ type: "cms-ready", path: location.pathname }, "*");
    document.addEventListener("click", onClick, true);
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      if (clearTimer) clearTimeout(clearTimer);
      if (moTimer) clearTimeout(moTimer);
      mo.disconnect();
      clearHighlight();
    };
  }, []);

  return null;
}
