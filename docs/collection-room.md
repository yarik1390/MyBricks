# Collection room

Open **Collection room** from the vault, then **Open 3D room** to display set
images in a room with shelves grouped by theme. The scene and existing Three.js
module load only after that button is pressed. The service worker precaches
the modules for offline navigation; importing or executing the renderer stays
interaction-gated.

Drag horizontally or use the look/zoom/reset buttons. Selecting an image opens
the set details. The standard shelf links remain available for keyboard and
screen-reader navigation, and when graphics are unavailable. There is no
automatic animation, including with reduced motion enabled.

The room shows distinct, active owned set identities and combines their copy
counts. Deleted holdings, zero quantities, and provisional additions are
excluded. Each theme has its own shelves, with four images per shelf and three
shelves per page. Filters and pagination keep every set reachable without
loading an entire large collection into the graphics context. Missing images
retain a readable set-number card in the scene.

Guest holdings use the existing device storage path. A failed collection read
can use the existing in-memory collection cache with a stale-data notice;
without a cache, the page offers a retry. No new backend, private-data storage,
model downloads, or database migration is introduced. Notes, costs, and account
identifiers are excluded from scene data. Owner changes clear the view and
invalidate late responses. Closing, changing shelves, navigation, and context
loss dispose images, textures, geometry, observers, and the renderer.

This is an image display room. Detailed set models, building instructions,
custom furniture, and room editing remain later work. Cached asset changes
use SW v502. This release contains no database changes.

Verification covers bounded shelf grouping, distinct quantities, private-field
exclusion and image URL handling with unit tests. Hermetic Playwright tests use
mocked APIs and actual local WebGL to cover opt-in loading, filters, pagination,
mobile layout, guest storage, low-memory fallback, graphics context loss,
account changes including delayed A–B–A reads, and selecting a scene image to
open details. Screenshots use fixture images, not a real collector's holdings.

The implementation passed 361 frontend tests in the original working checkout,
49 room/organizer/navigation browser checks, and seven focused room checks.
Fresh independent Sol/high feature review returned `ship` with no material
findings or proof gaps.

Release preparation against main at 307db9a passed all 342 frontend tests plus
script and translation gates, root lint, Worker TypeScript, frontend core
checkJs, all 792 Worker tests, and the complete 128-test browser suite. Existing
Stripe sourcemap warnings and three runtime internal-error messages were
emitted by the passing Worker suite. Desktop and 390px mobile screenshots were
inspected. Physical-device GPU coverage remains outside these browser checks.
