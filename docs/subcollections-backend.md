# Named subcollections backend

Named subcollections are owner-private lists of LEGO set identities. They store
set numbers, not collection holding IDs, and targets do not need to exist in the
catalog. A member can keep at most 50 lists; each list accepts an empty target
array or up to 200 input set IDs.

## HTTP interface

All endpoints require member authentication and return `Cache-Control: private,
no-store`.

- `GET /api/subcollections` returns
  `{ "subcollections": [{ "id", "name", "set_nums", "revision", "updated_at" }] }`.
  The complete response is the current portable representation of this data.
- `PUT /api/subcollections/:id` accepts `{ "name", "set_nums", "revision" }`.
  A client UUID with revision `0` creates a list at revision `1`. An edit must
  send the current positive revision and increments it. Successful creates and
  edits return `200` with `{ "subcollection": { ... } }`. A stale revision returns
  `409` with code `stale_revision` and the current revision. Invalid input
  returns `400`; exceeding 50 lists also returns `400` with code
  `subcollection_limit`.
- `DELETE /api/subcollections/:id` accepts `{ "revision" }`. It returns `204`
  when deleted, `409` for a stale revision, and `404` when that owner has no such
  list.

Names are trimmed, non-empty, and limited to 80 UTF-16 code units to match the
frontend `maxlength`. Client IDs must be RFC 4122 UUID versions 1-5. The API
validates the original `set_nums` array length before deduplication. Every item
must match `[A-Za-z0-9][A-Za-z0-9._-]{0,39}` after trimming; a purely numeric
item receives the standard `-1` suffix. Duplicate normalized IDs keep their
first position.

Write revisions must be safe non-negative JavaScript integers. An edit revision
must be below `Number.MAX_SAFE_INTEGER`, leaving room for the atomic increment;
the resulting final safe revision may still be read or used for deletion.

Quota and revision checks are part of their corresponding SQL writes. Every
query includes the authenticated owner. The table is registered with the
target's existing account-deletion purge.

## Backup and restore boundary

Self-service collection backups do not include named subcollections in this
phase. Existing restore code remains collection-specific and does not read,
replace, merge, or delete `user_subcollections`. Clients can export the complete
named-list payload through `GET /api/subcollections` until a separate backup
format change is designed and authorized.
