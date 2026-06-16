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

export interface RebrickableMinifigDetail {
  fig_num: string;
  name: string;
  num_parts: number | null;
  year: number | null;
  set_count: number | null;
  img_url: string | null;
}

// Fetch detailed metadata for a single minifig from Rebrickable.
export async function fetchMinifigDetail(
  figNum: string,
  env: Env,
): Promise<RebrickableMinifigDetail | null> {
  if (!env.REBRICKABLE_API_KEY) return null;
  try {
    const url = `https://rebrickable.com/api/v3/lego/minifigs/${encodeURIComponent(figNum)}/`;
    const resp = await fetchTracked(env, 'rebrickable', url, {
      headers: { Authorization: `key ${env.REBRICKABLE_API_KEY}` },
    }, { okStatuses: [404] });
    if (!resp.ok) return null;
    const data = await resp.json() as {
      fig_num: string;
      name: string;
      num_parts?: number;
      year_from?: number;
      set_count?: number;
      set_img_url?: string;
    };
    return {
      fig_num: data.fig_num,
      name: data.name,
      num_parts: data.num_parts ?? null,
      year: data.year_from ?? null,
      set_count: data.set_count ?? null,
      img_url: data.set_img_url || null,
    };
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

export interface RebrickableAlternate {
  moc_num: string;
  name: string;
  num_parts: number | null;
  year: number | null;
  designer: string | null;
  moc_img_url: string | null;
  moc_url: string | null;
}

// Fetch alternate builds (MOCs buildable from a set's parts) from Rebrickable,
// handling pagination. NOTE: the endpoint is /alternates/ (not /alts/, which
// 404s). Returns null only when the key is missing or the request hard-fails;
// an empty array means the set genuinely has no listed alternates.
export async function fetchSetAlternates(
  setNum: string,
  env: Env,
): Promise<RebrickableAlternate[] | null> {
  if (!env.REBRICKABLE_API_KEY) return null;
  const rb = setNum.includes('-') ? setNum : `${setNum}-1`;
  const alts: RebrickableAlternate[] = [];
  let url: string | null =
    `https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(rb)}/alternates/?page_size=100`;
  try {
    while (url) {
      const resp = await fetchTracked(env, 'rebrickable', url, {
        headers: { Authorization: `key ${env.REBRICKABLE_API_KEY}` },
      }, { okStatuses: [404] });
      if (resp.status === 404) return alts; // no alternates for this set
      if (!resp.ok) return alts.length ? alts : null;
      const data = await resp.json() as { next?: string | null; results?: Array<{
        set_num: string; name: string; num_parts?: number; year?: number;
        designer_name?: string; moc_img_url?: string | null; moc_url?: string | null;
      }> };
      for (const r of data.results || []) {
        alts.push({
          moc_num: r.set_num,
          name: r.name,
          num_parts: r.num_parts ?? null,
          year: r.year ?? null,
          designer: r.designer_name || null,
          moc_img_url: r.moc_img_url || null,
          moc_url: r.moc_url || null,
        });
      }
      url = data.next || null;
    }
    return alts;
  } catch {
    return alts.length ? alts : null;
  }
}
