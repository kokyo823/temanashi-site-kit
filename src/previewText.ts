/**
 * previewText.ts — 保存前のフォーム内容を、目印（data-cms-*）なしで下書きページに重ねる（2026-09-15）。
 *
 * 目印方式（CmsPreviewBridge の data-cms-text 等）は、サイト側で項目ごとに属性を付けて回る必要があり、
 * 付け忘れた項目はプレビューに出ない。店舗・広告LPのような「一覧の1件」は項目数が多く、サイトごとに違う。
 *
 * そこでポータルから「保存済みの内容（base）」と「今の入力（data）」を受け取り、
 *   1. 2つを比べて、変わった文字列・画像パスの組（旧→新）を集める（collectChanges）
 *   2. ページ上の文字（テキストノード）から旧い文字列を探して新しい文字列に置き換える（applyTextChanges）
 *   3. 画像は src が旧いパスの img を新しいパスに差し替える（applyImageChanges）
 * 下書きページは保存済みの内容で描かれているので、旧い文字列はそのままページにある、という前提を使う。
 *
 * できないこと（＝保存後の下書きで確認してもらう）:
 *   - 項目の追加・削除・並べ替え（ページの構造が変わる）→ structural=true で知らせる
 *   - 空欄だった項目への入力（ページに出る場所がまだ無い）→ 同上
 *   - サイト側で加工して出している文字（例 日付の書式変換）→ unmatched で知らせる
 */

export type Pair = [string, string];
export type Changes = { texts: Pair[]; images: Pair[]; structural: boolean };

const IMG_RE = /^(https?:\/\/[^\s]+|\/[^\s]+)\.(jpe?g|png|webp|gif|avif|svg)(\?[^\s]*)?$/i;
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** base と data を比べて、変わった文字列・画像パスの組を集める（DOMを使わない純関数） */
export function collectChanges(base: unknown, data: unknown): Changes {
  const texts: Pair[] = [];
  const images: Pair[] = [];
  let structural = false;
  const pushText = (b: string, d: string) => {
    // 改行を含む文章は、行数が同じなら行ごとに比べる（段落・br で分けて描くサイトでも当たるように）
    const bl = b.split("\n");
    const dl = d.split("\n");
    if (bl.length > 1 && bl.length === dl.length) {
      bl.forEach((line, i) => { if (line !== dl[i] && line.trim()) texts.push([line, dl[i]]); });
      return;
    }
    texts.push([b, d]);
  };
  const walk = (b: unknown, d: unknown): void => {
    if (Array.isArray(b) || Array.isArray(d)) {
      if (!Array.isArray(b) || !Array.isArray(d)) { if (b != null || (Array.isArray(d) && d.length)) structural = true; return; }
      if (b.length !== d.length) structural = true;
      if (b.length === d.length && b.length > 1) {
        const bs = b.map((x) => JSON.stringify(x));
        const ds = d.map((x) => JSON.stringify(x));
        if (JSON.stringify(bs) !== JSON.stringify(ds) && JSON.stringify([...bs].sort()) === JSON.stringify([...ds].sort())) {
          structural = true; // 中身は同じで順序だけ違う＝並べ替え
          return;
        }
      }
      for (let i = 0; i < Math.min(b.length, d.length); i++) walk(b[i], d[i]);
      return;
    }
    if (isObj(b) || isObj(d)) {
      if (!isObj(b) || !isObj(d)) { if (b != null) structural = true; return; }
      for (const k of new Set([...Object.keys(b), ...Object.keys(d)])) walk(b[k], d[k]);
      return;
    }
    if (typeof b === "number" || typeof d === "number") {
      if (b !== d && b != null && d != null) texts.push([String(b), String(d)]);
      return;
    }
    if (typeof b === "string" || typeof d === "string") {
      const bs = typeof b === "string" ? b : "";
      const ds = typeof d === "string" ? d : "";
      if (bs === ds) return;
      if (IMG_RE.test(bs.trim()) || IMG_RE.test(ds.trim())) {
        if (bs.trim()) images.push([bs.trim(), ds.trim()]);
        else structural = true;
        return;
      }
      if (!bs.trim()) { if (ds.trim()) structural = true; return; } // 空欄→入力はページに出る場所がまだ無い
      pushText(bs, ds);
      return;
    }
    if (b !== d && (b != null || d != null)) structural = true; // チェックボックス等＝表示の出し分けが変わる
  };
  walk(base, data);
  return { texts, images, structural };
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "TITLE", "TEMPLATE"]);
const ORIG_TEXT = new WeakMap<Text, string>();

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const doc = root.ownerDocument || (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const p = t.parentElement;
    if (p && (SKIP_TAGS.has(p.tagName) || p.closest("[data-cms-text]"))) continue; // 目印つきは目印方式に任せる
    out.push(t);
  }
  return out;
}

/**
 * ページ上の文字を置き換える。毎回「最初に見たときの文字（保存済みの内容）」から計算し直すので、
 * 入力を元に戻せばページも元に戻る（pairs が空なら全部元どおり）。
 * 旧い文字列が要素をまたいで描かれている場合（例 「4,400」と「円」を別の要素にする価格表示）は、
 * 片側の短い差分（3文字まで）を許して、その要素の文字だけを置き換える。
 */
export function applyTextChanges(root: Node, pairs: Pair[]): { unmatched: Pair[]; changedNodes: number } {
  const usable = pairs.filter(([o]) => o.trim().length >= 2);
  const matched = new Set<number>();
  let changedNodes = 0;
  for (const node of textNodes(root)) {
    if (!ORIG_TEXT.has(node)) ORIG_TEXT.set(node, node.nodeValue ?? "");
    const orig = ORIG_TEXT.get(node) as string;
    let next = orig;
    const core = orig.trim();
    if (core) {
      usable.forEach(([o, n], idx) => {
        if (next.includes(o)) { next = next.split(o).join(n); matched.add(idx); return; }
        if (core.length < 2 || !o.includes(core) || core === o) return;
        if (o.startsWith(core)) {
          const rest = o.slice(core.length);
          if (rest.length <= 3 && n.endsWith(rest)) { next = next.replace(core, n.slice(0, n.length - rest.length)); matched.add(idx); }
        } else if (o.endsWith(core)) {
          const rest = o.slice(0, o.length - core.length);
          if (rest.length <= 3 && n.startsWith(rest)) { next = next.replace(core, n.slice(rest.length)); matched.add(idx); }
        }
      });
    }
    if (next !== node.nodeValue) { node.nodeValue = next; changedNodes++; }
  }
  return { unmatched: usable.filter((_, i) => !matched.has(i)), changedNodes };
}

const ORIG_SRC = new WeakMap<HTMLImageElement, { src: string; srcset: string | null }>();

/** src が旧いパスの img を差し替える。戻り値は見つからなかった組 */
export function applyImageChanges(root: ParentNode, pairs: Pair[]): Pair[] {
  const matched = new Set<number>();
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img"))) {
    if (img.hasAttribute("data-cms-img")) continue; // 目印つきは目印方式に任せる
    if (!ORIG_SRC.has(img)) ORIG_SRC.set(img, { src: img.getAttribute("src") || "", srcset: img.getAttribute("srcset") });
    const orig = ORIG_SRC.get(img) as { src: string; srcset: string | null };
    let next = orig.src;
    let decoded = orig.src;
    try { decoded = decodeURI(orig.src); } catch { /* そのまま */ }
    pairs.forEach(([o, n], i) => {
      if (o && (orig.src === o || orig.src.endsWith(o) || decoded.endsWith(o))) { next = n; matched.add(i); }
    });
    if (next !== img.getAttribute("src")) img.setAttribute("src", next);
    if (next === orig.src) { if (orig.srcset != null && img.getAttribute("srcset") !== orig.srcset) img.setAttribute("srcset", orig.srcset); }
    else img.removeAttribute("srcset");
  }
  return pairs.filter((_, i) => !matched.has(i));
}

/** フォームで触っている項目の文字をページから探す（ハイライト用）。見えている要素を優先 */
export function findElementByText(root: Node, text: string): HTMLElement | null {
  const first = String(text || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  for (const q of [first.slice(0, 60), first.slice(0, 20)]) {
    if (q.length < 2) continue;
    let fallback: HTMLElement | null = null;
    for (const node of textNodes(root)) {
      if (!(node.nodeValue || "").includes(q) || !node.parentElement) continue;
      const el = node.parentElement;
      if (el.getClientRects().length) return el;
      fallback = fallback || el;
    }
    if (fallback) return fallback;
  }
  return null;
}
