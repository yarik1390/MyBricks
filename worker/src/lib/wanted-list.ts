// Wanted-list files for parts a collector needs: the pieces they marked missing
// from owned sets, or the shortfall to build a set from the parts they own.
//
// Two formats, both of which the target sites import directly:
//  - Rebrickable part-list CSV ("Part,Color,Quantity") with Rebrickable ids —
//    exactly the ids set_parts carries, so it is lossless.
//  - BrickLink wanted-list XML (<INVENTORY><ITEM>…). Colors are translated with
//    the Rebrickable → BrickLink map; part numbers are passed through (they
//    match for the vast majority of molds; Rebrickable's own BrickLink export
//    is the fallback for the rare mismatch). Parts whose color has no BrickLink
//    equivalent are left out and counted in `skipped`.

export interface WantedPart {
  part_num: string;
  color_id: number;
  quantity: number;
  part_name?: string | null;
  color_name?: string | null;
}

/** Merge rows for the same part+color (summing quantities), drop non-positive. */
export function mergeWantedParts(rows: WantedPart[]): WantedPart[] {
  const byKey = new Map<string, WantedPart>();
  for (const r of rows) {
    const qty = Math.floor(Number(r.quantity) || 0);
    if (!r.part_num || qty <= 0) continue;
    const key = `${r.part_num}:${Number(r.color_id) || 0}`;
    const prev = byKey.get(key);
    if (prev) prev.quantity += qty;
    else byKey.set(key, { ...r, color_id: Number(r.color_id) || 0, quantity: qty });
  }
  return [...byKey.values()].sort((a, b) => b.quantity - a.quantity || a.part_num.localeCompare(b.part_num));
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toRebrickableCsv(parts: WantedPart[]): string {
  const lines = ['Part,Color,Quantity'];
  for (const p of parts) lines.push([csvCell(p.part_num), p.color_id, p.quantity].join(','));
  return lines.join('\n') + '\n';
}

const xmlText = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** BrickLink wanted-list XML. `colorFor` maps a Rebrickable color id to the
 *  BrickLink id, or null when BrickLink has no such color (part skipped). */
export function toBrickLinkXml(
  parts: WantedPart[],
  colorFor: (rbColorId: number) => number | null,
): { xml: string; skipped: number } {
  let skipped = 0;
  const items: string[] = [];
  for (const p of parts) {
    const color = colorFor(p.color_id);
    if (color == null) { skipped++; continue; }
    items.push(`  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>${xmlText(p.part_num)}</ITEMID>\n    <COLOR>${color}</COLOR>\n    <MINQTY>${p.quantity}</MINQTY>\n    <CONDITION>X</CONDITION>\n    <NOTIFY>N</NOTIFY>\n  </ITEM>`);
  }
  return { xml: `<INVENTORY>\n${items.join('\n')}\n</INVENTORY>\n`, skipped };
}
