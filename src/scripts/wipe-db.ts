/**
 * Retired on purpose.
 *
 * This file used to delete the tournament database without a backup, an
 * environment check, or an exact database-name confirmation. Keep this guard
 * in place so an old runbook cannot accidentally erase production data.
 */

console.error(
  'Unsafe database wipe is disabled. Run `npm run db:cleanup:inventory` first, then use the guarded cleanup command only after a verified backup and an approved collection manifest.'
);

process.exitCode = 1;
