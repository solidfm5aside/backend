/**
 * Retired on purpose.
 *
 * The former development seeder deleted live collections through MONGODB_URI
 * and recreated an obsolete 28-team format. Keeping this fail-closed stub
 * prevents an old command or runbook from bypassing the guarded reset tools.
 */

console.error(
  'Unsafe legacy seeding is disabled. Create teams, players, and the fixed 14-team tournament through the admin workflow. Use `npm run db:cleanup:inventory` before any approved reset.'
);

process.exitCode = 1;
