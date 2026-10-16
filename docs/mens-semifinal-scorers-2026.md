# Official men's semi-final scorers

Confirmed by the tournament owner on 16 October 2026:

- Samba Boys 1–0 Smooth Citizens: Chimaobi Ekwueme.
- Lala Brothers 2–1 Mr Phil Photo: the existing Lala Own Goal entry, Godswill, and Chinedu (Mr Phil Photo).

The existing Own Goal bookkeeping record keeps that goal separate from real players. Goal minutes are unreported: events use the console's required 0 placeholder and explicit notes that the minute is not known.

The one-off scorer script validates the exact men's tournament, participants, scores, winners, locks and registered names/teams. It appends goal attribution without changing scores, schedules or winners, preserves non-goal events, and rebuilds men's derived statistics in the same transaction. Existing conflicting goals abort; deterministic operation keys make retries a no-op. Women's data is never targeted.

The temporary release command runs a read-only plan followed by --execute. Normal server startup is restored after verification. Future leaderboard corrections should update the underlying match events because recalculation replaces direct total edits.
