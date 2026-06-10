import type { Env } from '../types';
import { fetchTracked } from './http';

export interface RebrickableMinifig {
  fig_num: string;
  quantity: number;
  fig_name: string;
  fig_img_url: string | null;
}

export interface RebrickablePart {
  part_num: string;
  color_id: number;
  color_name: string;
  quantity: number;
  is_spare: boolean;
  part_name: string;
  part_img_url: string | null;
}

// Fetch minifigs included in a set from the Rebrickable API.
// Returns null when the API key is not configured or the request fails.
export async function fetchSetMinifigs(
  setNum: string,
  env: Env,
): Promise<RebrickableMinifig[] | null> {
  if (!env.REBRICKABLE_API_KEY) return null;
  const rb = setNum.includes('-') ? setNum : `${setNum}-1`;
  try {
    const url = `https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(rb)}/minifigs/?page_size=100`;
    const resp = await fetchTracked(env, 'rebrickable', url, {
      headers: { Authorization: `key ${env.REBRICKABLE_API_KEY}` },
    }, { okStatuses: [404] });
    if (!resp.ok) return null;
    const data = await resp.json() as { results?: Array<{
      fig_num: string; quantity: number; set_num?: string;
      name?: string; img_url?: string; set_img_url?: string;
    }> };
    return (data.results || []).map(r => ({
      fig_num: r.fig_num,
      quantity: r.quantity,
      fig_name: r.name || r.fig_num,
      fig_img_url: r.img_url || null,
    }));
  } catch {
    return null;
  }
}

// Fetch all parts in a set from Rebrickable, handling pagination.
export async function fetchSetParts(
  setNum: string,
  env: Env,
): Promise<RebrickablePart[] | null> {
  if (!env.REBRICKABLE_API_KEY) return null;
  const rb = setNum.includes('-') ? setNum : `${setNum}-1`;
  const parts: RebrickablePart[] = [];
  let url: string | null =
    `https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(rb)}/parts/?page_size=500`;
  try {
    while (url) {
      const resp = await fetchTracked(env, 'rebrickable', url, {
        headers: { Authorization: `key ${env.REBRICKABLE_API_KEY}` },
      }, { okStatuses: [404] });
      if (!resp.ok) return parts.length ? parts : null;
      const data = await resp.json() as { next?: string | null; results?: Array<{
        part: { part_num: string; name: string; part_img_url?: string | null };
        color: { id: number; name: string };
        quantity: number;
        is_spare: boolean;
      }> };
      for (const r of data.results || []) {
        parts.push({
          part_num: r.part.part_num,
          color_id: r.color.id,
          color_name: r.color.name,
          quantity: r.quantity,
          is_spare: r.is_spare,
          part_name: r.part.name,
          part_img_url: r.part.part_img_url || null,
        });
      }
      url = data.next || null;
    }
    return parts;
  } catch {
    return parts.length ? parts : null;
  }
}
