// Named lists contain set identities, never copies or references to holding IDs.
export function canonicalSetNum(value) {
  const num = String(value ?? '').trim();
  return /^\d+$/.test(num) ? `${num}-1` : num;
}

export function normalizeSubcollection(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80
    || !Array.isArray(body.set_nums) || body.set_nums.length > 200
    || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error('invalid');
  const setNums = body.set_nums.map(value => {
    if (typeof value !== 'string') throw new Error('invalid');
    const num = canonicalSetNum(value);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(num)) throw new Error('invalid');
    return num;
  });
  return { name: body.name.trim(), set_nums: [...new Set(setNums)], revision: body.revision };
}

export function activeHoldings(items = []) {
  return items.filter(row => !row.deleted_at && Number(row.quantity ?? 1) > 0 && !row._pendingCollectionNew);
}

export function collectionProgress(list, items) {
  const owned = new Set(activeHoldings(items).map(row => canonicalSetNum(row.set_num)));
  const targets = [...new Set(list.set_nums.map(canonicalSetNum))];
  const acquired = targets.filter(num => owned.has(num));
  return { total: targets.length, owned: acquired.length, missing: targets.filter(num => !owned.has(num)), complete: targets.length > 0 && acquired.length === targets.length };
}

export function collectorInsights(items) {
  const rows = activeHoldings(items);
  const missingCost = rows.filter(row => row.purchase_price == null || row.purchase_price === '' || !Number.isFinite(Number(row.purchase_price)) || Number(row.purchase_price) < 0);
  const missingDate = rows.filter(row => !row.purchased_at);
  const incomplete = rows.filter(row => row.is_complete === false || row.is_complete === 0 || Number(row.missing_pieces) > 0);
  const complete = rows.filter(row => (row.is_complete === true || row.is_complete === 1) && !(Number(row.missing_pieces) > 0));
  return { rows, missingCost, missingDate, incomplete, complete, distinct: new Set(rows.map(row => canonicalSetNum(row.set_num))).size };
}
