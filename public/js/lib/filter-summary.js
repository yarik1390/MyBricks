import { catalogFilterSummary, figFilterSummary } from './pure.js';

// Pure summary data is intentionally kept separate from language-specific
// rendering. Callers supply the app's t/tPlural functions, while the final
// HTML sink remains responsible for escaping catalog and search values.
export function catalogFilterSummaryText(filter, t, tPlural) {
  const summary = catalogFilterSummary(filter);
  if (!summary.count) return t('catalog.filterSummaryNone');
  const rangeValue = (field, value) => field === 'pieces'
    ? t('catalog.filterSummaryPiecesValue', { value })
    : field === 'value' ? t('catalog.filterSummaryValueAmount', { value }) : String(value);
  const parts = summary.parts.map((part) => {
    if (part.kind === 'search') return t('catalog.filterSummarySearch', { value: part.value });
    if (part.kind === 'status') return t(`catalog.filterSummaryStatus${part.value[0].toUpperCase()}${part.value.slice(1)}`);
    if (part.kind === 'deal') return t('catalog.filterSummaryDeal');
    if (part.kind === 'range') {
      const label = t(`catalog.filterSummaryRange${part.field[0].toUpperCase()}${part.field.slice(1)}`);
      if (part.min != null && part.max != null) return t('catalog.filterSummaryRangeBetween', { label, min: rangeValue(part.field, part.min), max: rangeValue(part.field, part.max) });
      if (part.min != null) return t('catalog.filterSummaryRangeMin', { label, value: rangeValue(part.field, part.min) });
      return t('catalog.filterSummaryRangeMax', { label, value: rangeValue(part.field, part.max) });
    }
    return part.value;
  });
  return tPlural('catalog.filterSummaryActive', summary.count, { items: parts.join(' · ') });
}

export function figFilterSummaryText(filter, t, tPlural) {
  const summary = figFilterSummary(filter);
  if (!summary.count) return t('minifigs.filterSummaryNone');
  const parts = summary.parts.map((part) => {
    if (part.kind === 'search') return t('minifigs.filterSummarySearch', { value: part.value });
    if (part.kind === 'rarity') {
      const key = `minifigs.filterSummaryRarity${part.value[0].toUpperCase()}${part.value.slice(1)}`;
      return t('minifigs.filterSummaryRarity', { rarity: t(key) });
    }
    if (part.kind === 'ownership') return t(`minifigs.filterSummary${part.value[0].toUpperCase()}${part.value.slice(1)}`);
    return part.value;
  });
  return tPlural('minifigs.filterSummaryActive', summary.count, { items: parts.join(' · ') });
}
