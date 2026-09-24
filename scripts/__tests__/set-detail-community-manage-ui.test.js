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
  it('keeps every contribution path and the moderation truth', () => {
    // Review and photo live in the pinned bottom bar on the Community tab;
    // "Suggest a fix" is a row inside the tab. All three route through the
    // delegated [data-contrib] handler.
    const bar = sourceBetween('function setBarHTML(', '// Hero photo count');
    assert.match(bar, /tab === "community"/);
    assert.match(bar, /data-contrib="photo"/);
    assert.match(bar, /data-contrib="review"/);
    assert.match(communityTemplate, /"data-contrib": "fix"/);
    assert.match(communityTemplate, /bvSet\.suggestFix/);
    assert.match(detailSource, /act === "review"\) openReviewSheet/);
    assert.match(detailSource, /act === "photo"\) openPhotoSheet/);
    assert.match(detailSource, /else openDataFixSheet\(set\.set_num, refresh\)/);
    assert.match(communityTemplate, /role="note"/);
    assert.match(communityTemplate, /bvSet\.trustGuest/);
    assert.match(communityTemplate, /bvSet\.trustMember/);
    assert.match(communityTemplate, /bvSet\.communityLoading/);
  });

  it('renders rating, photos, reviews and reported sales, with one intentional empty state', () => {
    assert.match(communityWiring, /class="bv-card bv-rating community-rating-section"/);
    assert.match(communityWiring, /bvSet\.ratingReviews/);
    assert.match(communityWiring, /bvSet\.collectorPhotos/);
    assert.match(communityWiring, /bvSet\.reviews/);
    assert.match(communityWiring, /bvSet\.reportedSales/);
    assert.equal((communityWiring.match(/community-empty"/g) || []).length, 1);
    assert.match(communityWiring, /bvSet\.communityEmpty/);

    // Approved content and pending contribution truth remain distinct and visible.
    assert.match(communityWiring, /reviews\.length/);
    assert.match(communityWiring, /photos\.length/);
    assert.match(communityWiring, /prices\.length/);
    assert.match(communityWiring, /m\.status === "pending"/);
    assert.match(communityWiring, /community\.pendingSubmission/);
    assert.match(communityWiring, /bvSet\.communityFailed/);
  });
});

describe('set-detail Manage UI hierarchy', () => {
  it('explains autosave and groups existing fields without changing their IDs or labels', () => {
    assert.match(manageTemplate, /<div class="manage-tab bv-passport__body">/);
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
    assert.match(manageTemplate, /bvSet\.yourPhotos/);
    assert.match(manageTemplate, /bvSet\.memories/);
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
    assert.match(serviceWorker, /const VERSION = "v\d+"/);
    assert.match(serviceWorker, /'\/app\.css'/);
    assert.match(serviceWorker, /'\/js\/views\/portfolio-detail\.js'/);
  });
});
