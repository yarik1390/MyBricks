# Loose minifigure holdings

The Minifigs detail sheet records quantity, condition, optional per-unit purchase
cost, purchase date, and private notes. All copies of one figure share one record.
Loose figures are tracked separately from figures included in owned sets.

Costs are stored in USD and converted for display. A blank cost is unknown;
zero records a free acquisition. Editing another field preserves the stored
cost's precision. Separate purchase lots and minifigure sales are future work.

Guest records stay on the device. Explicit guest-vault migration includes these
details, preserves an existing account holding on collision, and retains local
records when saving cannot be confirmed. Account switching stops the transfer.

The Minifigs page exports the current owner's records as CSV, with costs labeled
USD and spreadsheet formulas escaped. The export does not add a CSV import flow.
Self-service vault snapshots do not include loose minifigures; keep a separate CSV
copy. Whole-database backups include the user_minifigs table.

The release applies four additive user_minifigs columns before the updated Worker
ships. Existing records keep their quantities, with unknown condition and empty
optional details. The deployment workflow probes the new columns. Public catalog
and pricing behavior is preserved; private fields appear only in the owner's
separate holding object and authenticated export.
