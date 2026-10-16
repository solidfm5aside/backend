# Official men's semi-final result correction

The public API on 16 October 2026 returned four completed quarter-finals and no semi-finals for men's tournament `6a88bfa4ce2cf64818770691`. Fixtures already excludes completed matches; Results requests completed matches only.

This one-off import uses the existing durable bracket topology and validated quarter-final winners. It records Samba Boys FC 1–0 Smooth Citizens FC and Lala Brothers FC 2–1 Mr Phil Photo FC, resolves their bracket nodes, and creates one scheduled final between Samba and Lala. Existing home/away orientation is retained. No goal scorers, dates or venues are invented. Historical results without supplied dates keep a pending schedule; their match status is completed. The frontend labels these records as completed and puts them first for the men's competition.

All changes occur in one MongoDB transaction. The importer targets the exact men's tournament ID, division, season, format and active bracket. It refuses conflicting results, active semi-finals, dangling/duplicate references, or a final that has started. Repeated execution after success is a no-op. Women's records, group matches, existing quarter-finals, player events and standings are not written. The semi-finals are locked once their winners are consumed. Quarter-final scores/events are never rewritten; downstream bracket references prevent edits through the existing service guards.

## After approval only

Use an environment with the intended database's MONGODB_URI and MongoDB transaction support. Do not commit credentials.

Read-only plan:

```sh
npx ts-node -r tsconfig-paths/register src/scripts/record-official-mens-semifinals.ts
```

Apply the reviewed plan:

```sh
npx ts-node -r tsconfig-paths/register src/scripts/record-official-mens-semifinals.ts --execute
```

The importer does not run at server startup or during build. A normal backend deployment alone does not apply the data repair. After execution, verify the public matches endpoint returns two completed semi-finals with the exact scores and one scheduled final, and compare all previous men's and women's matches against the before snapshot. Open Results and Fixtures to verify placement. No production database connection or import was performed during preparation.
