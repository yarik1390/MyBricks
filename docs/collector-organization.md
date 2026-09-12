# Collection organization

Open **Collections & insights** from the vault to create named subcollections.
Select individual owned sets by name, add all owned sets, or enter set numbers
for a target series. A list can contain 200 distinct set identities; an account
or guest device can keep 50 lists. Lists can overlap without changing holdings
or collection totals. Empty lists do not count as complete.

Progress counts distinct set identities in confirmed, active holdings. Extra
copies cannot increase completion, and deleted holdings and provisional
additions are excluded. This is ownership of the chosen target list, not a claim
to have completed an entire LEGO theme or built every model. A separate insight
shows holdings explicitly marked complete or incomplete.

Purchase-record insights link directly to set details. They count holding rows,
and an explicit purchase cost of zero is a known cost. Missing costs and dates
are separate filters. Nothing is inferred from market prices or added dates.

Signed-in lists are private server data and require a connection. Guest lists
are saved on the current device, work offline, and stay separate on sign-in;
automatic guest-list migration is not included. Revision checks prevent stale
edits from overwriting newer changes. Failed saves retain the editor's draft.
Owner changes clear private organizer content and discard late responses.

**Export lists** saves JSON on web or uses the existing native file share helper.
This release does not import that JSON or include lists in self-service vault
backups. The UI discloses the backup and guest migration limits. Deleting a list
leaves holdings intact. The existing account-deletion purge includes the list
table. See [backend details](subcollections-backend.md).

The deployment applies the table before shipping service-worker version v501.
The organizer route and its helpers are lazy-loaded and precached;
service-worker API bypasses are unchanged.
