# Walkable collection showroom

Use **Enter collection room** in the Vault to enter a full-screen first-person
showroom directly. The renderer initializes only when the room opens; the
service worker still caches its existing modules for offline navigation.
This revision replaces the fixed shelf viewer shipped in c165836.

Walk with WASD or arrow keys and drag to look around. **Capture mouse** enables
continuous mouse look; Escape releases it. On mobile, use the left joystick
while dragging elsewhere to look. Movement has no head bobbing or automatic
camera tours. Opening a panel, hiding the app, or losing focus stops movement.

Theme shelves hold solid display boxes with existing set images on the fronts
and neutral sides. Dimensions are illustrative. One box represents a distinct
active set; quantities appear in its details. Deleted, zero-quantity, and
provisional new holdings are excluded. Walls and furniture block walking.

Select a box to open its details without leaving the room. The panel shows the
image, title, identity, theme, and copy count. **Open full details** navigates to
the existing set page; returning preserves the camera for the same account.
**Find a set or theme** searches all holdings and moves to a clear position at
the selected shelf. **Accessible list** offers searchable keyboard-accessible
details, including on devices where graphics are unavailable.

The showroom layout extends with the collection. Only nearby geometry and
textures remain loaded, keeping graphics work bounded. Guest collections use
existing device storage. Cached collection reads carry a stale-data notice.
There are no new backend endpoints, database changes, or persistent room data.
Account changes discard the camera, clear private room content, close room
panels, and reject late responses. Navigation releases graphics and controls.

This release uses service-worker asset version v503.
Detailed assembled models, avatars, room editing, multiplayer, and
building animations remain outside this feature.

## Verification

Acceptance covers first-person movement/collisions, deterministic large-room
layout and bounded resources, real box selection, panel pause/resume, returning
from details, simultaneous mobile joystick/look, focus loss, guest fallback,
context loss/retry, cached reads, owner transitions, and route cleanup. Browser
tests use isolated collection fixtures and local WebGL; no live holdings are
modified. Physical-device graphics performance requires separate device testing.

Local validation passed 346 frontend tests, the translation/string gates, lint,
Worker TypeScript and frontend core checkJs. The full 129-test browser suite
passed, followed by all nine room tests after the final input corrections,
including actual Chromium pointer capture and release into a detail panel.
Desktop and 390px touch screenshots were inspected using fixture images.
Independent Sol review cleared the change after the theme-material cache was
bounded to six palette colors. The distant-shelf browser check and renderer
lint passed again after that correction.
The complete Worker test suite passed during deployment preparation.
