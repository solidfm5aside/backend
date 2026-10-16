# Official men's knockout schedules

Source: the tournament owner's semi-final poster dated 5 October 2026 and final poster dated 14 October 2026, provided on 16 October 2026.

| Match | Date (Africa/Lagos) | Kickoff | Venue |
| --- | --- | --- | --- |
| Samba Boys 1–0 Smooth Citizens | 11 October 2026 | 15:00 WAT | Wembley Arena |
| Lala Brothers 2–1 Mr Phil Photo | 11 October 2026 | 15:00 WAT | Tribu Arena |
| Samba Boys vs Lala Brothers | 18 October 2026 | 15:00 WAT | Wembley Arena, Trans Ekulu, Enugu |

The targeted `record-official-mens-knockout-schedules.ts` script validates the exact men's 2026 tournament, active bracket, participants, scores and statuses before updating schedule metadata in one transaction. Completed semi-final results and locks are retained. The final stays scheduled. Only pending schedules are filled; conflicting confirmed schedules abort. A repeat with the exact same schedule is a no-op.

Wembley Arena is registered using the address on the final poster. Wembley Hotel and all previous venue labels are retained, rather than renaming historical records. Women's tournament data is never targeted. All timestamps store the corresponding UTC time (14:00Z).

Read-only plan: `node dist/scripts/record-official-mens-knockout-schedules.js`.
Apply: add `--execute`. A temporary release start command runs the plan then the update; normal server startup is restored immediately after verification.
