import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const detailSource = read('public/js/views/portfolio-detail.js');
const appStyles = read('public/app.css');
const serviceWorker = read('public/sw.js');

function sourceBetween(startMarker, endMarker) {
  const start = detailSource.indexOf(startMarker);
  const end = detailSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  assert.notEqual(end, -1, `${endMarker} must follow ${startMarker}`);
  return detailSource.slice(start, end);
}

const manageTemplate = sourceBetween('function manageTabHTML(', '// Sell-timing read for this holding');
const communityTemplate = sourceBetween('function communityTabHTML(', 'function starRow(');
const communityWiring = sourceBetween('async function wireCommunityTab(', 'function setupTabSwipe(');

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appStyles.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\}`));
  assert.ok(match, `${selector} CSS rule must exist`);
  return match[0];
}

describe('set-detail Community UI hierarchy', () => {
  it('welcomes people with semantic framing while preserving contribution actions and moderation truth', () => {
    assert.match(communityTemplate, /<header class="community-intro">/);
    assert.match(communityTemplate, /class="community-eyebrow"/);
    assert.match(communityTemplate, /<h2[^>]*>Community record<\/h2>/);
    assert.match(communityTemplate, /<div class="community-actions" aria-label="Community contributions">/);

    for (const [act, label] of [
      ['review', 'Write a review'],
      ['photo', 'Add photo'],
      ['fix', 'Suggest a fix'],
    ]) {
      assert.match(communityTemplate, new RegExp(`data-act="${act}"[^>]*>[\\s\\S]*?${label}`));
    }
    assert.equal((communityTemplate.match(/data-act="(?:review|photo|fix)"/g) || []).length, 3);
    assert.match(communityTemplate, /class="community-action-copy"/);
    assert.match(communityTemplate, /role="note"/);
    assert.match(communityTemplate, /class="community-trust-mark" aria-hidden="true"/);
    assert.match(communityTemplate, /class="u-sr-only">Trust note:/);
    assert.match(communityTemplate, /Contributions are reviewed before becoming public, keeping shared set data trustworthy\./);
    assert.match(communityTemplate, /Guest mode can browse community content\. Sign in before contributing/);
  });

  it('renders labelled content sections, count/value hierarchy, and one intentional empty card', () => {
    assert.match(communityWiring, /<section class="community-section community-rating-section" aria-labelledby="communityRatingTitle">/);
    assert.match(communityWiring, /id="communityRatingTitle"/);
    assert.match(communityWiring, /class="community-rating-value"/);
    assert.match(communityWiring, /<section class="community-section" aria-labelledby="communityPhotosTitle">/);
    assert.match(communityWiring, /<section class="community-section" aria-labelledby="communityReviewsTitle">/);
    assert.match(communityWiring, /<section class="community-section community-prices" aria-labelledby="communityPricesTitle">/);
    assert.match(communityWiring, /class="community-section-count"/);
    assert.match(communityWiring, /class="community-empty"/);
    assert.equal((communityWiring.match(/class="community-empty"/g) || []).length, 1);
    assert.doesNotMatch(communityWiring, /No ratings yet — be the first/);
    assert.match(communityWiring, /Start this set’s community record/);
    assert.match(communityWiring, /Share the first review or photo, or suggest a correction for the set data\./);

    // Approved content and pending contribution truth remain distinct and visible.
    assert.match(communityWiring, /reviews\.length/);
    assert.match(communityWiring, /photos\.length/);
    assert.match(communityWiring, /prices\.length/);
    assert.match(communityWiring, /m\.status === "pending"/);
    assert.match(communityWiring, /community\.pendingSubmission/);
    assert.match(communityWiring, /Couldn't load community content\./);
    assert.match(communityTemplate, /Loading community content…/);
  });
});

describe('set-detail Manage UI hierarchy', () => {
  it('explains autosave and groups existing fields without changing their IDs or labels', () => {
    assert.match(manageTemplate, /<div class="manage-tab">/);
    assert.match(manageTemplate, /<header class="manage-intro">/);
    assert.match(manageTemplate, /<h2[^>]*>Manage this set<\/h2>/);
    assert.match(manageTemplate, /Changes save automatically/);
    assert.match(manageTemplate, /id="manageSaveState"[^>]*aria-live="polite"/);
    assert.equal((manageTemplate.match(/class="form-group manage-group"/g) || []).length, 3);
    assert.equal((manageTemplate.match(/class="manage-group-description"/g) || []).length, 3);
    assert.equal((manageTemplate.match(/class="manage-field-grid"/g) || []).length, 3);

    for (const id of ['mPrice', 'mDate', 'mAcquisition', 'mCondition', 'mStorage', 'mNotes']) {
      assert.match(manageTemplate, new RegExp(`for="${id}"`), `${id} must keep its label association`);
      assert.match(manageTemplate, new RegExp(`id="${id}"`), `${id} must remain wired`);
    }
    for (const id of [
      'mPriceErr', 'mComplete', 'missingWrap', 'mMissing', 'storageLocations',
      'mFlipCalcContainer', 'partsCard', 'loadPartsBtn', 'partsContent',
      'photoUpload', 'photoUploadBtn', 'photoUploadStatus', 'storyCard',
      'storyTimeline', 'storyInput', 'storyAddNote', 'storyAddPhoto',
      'storyPhotoInput', 'mSold', 'mRemove', 'mListSale',
    ]) {
      assert.match(manageTemplate, new RegExp(`id="${id}"`), `${id} must remain wired`);
    }
  });

  it('keeps supporting tools and separates the destructive vault removal action', () => {
    assert.match(manageTemplate, /Flip calculator/);
    assert.match(manageTemplate, /Parts completeness/);
    assert.match(manageTemplate, /Custom photo/);
    assert.match(manageTemplate, /Story/);
    assert.match(manageTemplate, /sellTimingHTML\(set, entry\)/);
    assert.match(detailSource, /<span>Sell timing<\/span>/);
    assert.match(manageTemplate, /id="mSold"/);
    assert.match(manageTemplate, /id="mListSale"/);
    assert.match(manageTemplate, /<section class="manage-danger-zone" aria-labelledby="manageDangerTitle">/);
    assert.match(manageTemplate, /id="manageDangerTitle"/);
    assert.match(manageTemplate, /id="mRemove"/);
    assert.match(detailSource, /page\.dataset\.detailTab = tab/);
  });

  it('provides desktop field columns, a <=430px single column, and touch-sized controls', () => {
    const grid = cssRule('.manage-field-grid');
    assert.match(grid, /display:\s*grid/);
    assert.match(grid, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);

    assert.match(appStyles, /@media \(max-width:\s*430px\)\s*\{[\s\S]*?\.manage-field-grid,[\s\S]*?grid-template-columns:\s*1fr/);
    assert.match(appStyles, /\.manage-tab \.field input,\s*\.manage-tab \.field select,\s*\.manage-tab \.field textarea\s*\{[\s\S]*?min-height:\s*44px/);
    assert.match(appStyles, /\.manage-tab \.field textarea\s*\{[\s\S]*?min-height:\s*(?:8[8-9]|9\d|1\d\d)px/);
    assert.match(cssRule('.manage-save-bar'), /position:\s*sticky/);
    assert.match(appStyles, /detail-tabs \[data-tab="community"\]\.active\) \.advisor-fab/);
    assert.match(appStyles, /detail-tabs \[data-tab="manage"\]\.active\) \.advisor-fab/);
  });
});

describe('set-detail UI static asset contract', () => {
  it('bumps the service worker cache after JS and CSS changes', () => {
    assert.match(serviceWorker, /const VERSION = "v469";/);
    assert.match(serviceWorker, /'\/app\.css'/);
    assert.match(serviceWorker, /'\/js\/views\/portfolio-detail\.js'/);
  });
});
