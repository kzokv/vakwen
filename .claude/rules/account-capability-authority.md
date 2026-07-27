# Account Capability Authority and Synchronization

Portfolio market/currency capabilities are derived state, not preferences.

- Derive them from the viewed owner's active accounts in the domain layer. Never include soft-deleted accounts or derive shared-view capabilities from the viewer's accounts.
- Embed the capability snapshot in shell and route-primary DTOs that already load the surface. Do not add a page-by-page capability waterfall.
- Account mutation responses are authoritative for the initiating client and must include the resulting capabilities plus effective reporting currency.
- Treat account lifecycle SSE events as invalidation signals in other clients. `BufferedEventBus` can replay an older event after a newer mutation has committed, so do not overwrite live capability state from an event payload; clear narrow caches and refetch the current viewed-owner snapshot.
- When a route arrives with a stale market/currency selection, normalize from the server-seeded primary DTO before mounting controlled selectors when possible. Replace the URL and retain a dismissible explanation. This avoids a transient unsupported selection and controlled-widget remount loops.

Apply this rule to account create/update/delete/restore/purge, shared-owner context switching, and any route that filters operational controls by configured markets or currencies.
