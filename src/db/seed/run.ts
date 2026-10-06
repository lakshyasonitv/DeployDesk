/**
 * Demo seed orchestrator.
 *
 *   npm run db:seed
 *
 * Runs against DIRECT_URL (port 5432), not the pooler. Safe to re-run: it truncates the
 * tables it owns and rebuilds them.
 *
 * Reference: docs/SEED-DATA.md. Deliberate deviations from the prototype, each recorded
 * in docs/DECISIONS.md:
 *   - client rate bands derive from the proposed CLIENT rate (ADR-004), so they read
 *     higher than the mockups, which bracket the vendor cost and leak the margin;
 *   - algo_score is computed from the six components, not copied (ADR-011);
 *   - vendor attribution follows the ops pools where the roster table disagrees;
 *   - margin is stored nowhere; it is derived from the two rate columns on read.
 */
import { client, log, reset } from "./ctx";
import { seedOrgs, seedSkills } from "./orgs";
import { seedResources } from "./resources";
import { seedDualRole, seedDualRoleRequirement } from "./dual-role";
import { seedDemand, seedShortlists } from "./demand";
import {
  seedInterviews, seedEngagements, seedDuplicates, seedBrokerThreads, seedAudit,
  seedSensitiveColumns,
} from "./ops-extras";
import { SEED_NOW } from "./helpers";

async function main() {
  const started = Date.now();
  log(`\nSeeding DeployDesk by Talentvibes`);
  log(`  SEED_NOW = ${SEED_NOW.toISOString()} (fixture offsets are relative to this)\n`);

  await reset();
  const org = await seedOrgs();
  const skills = await seedSkills();
  // Capabilities, groups, memberships and blocks before anything that depends on them.
  const dualRole = await seedDualRole(org);
  const res = await seedResources(org, skills);
  const demand = await seedDemand(org, skills, res, dualRole);
  await seedDualRoleRequirement(org);
  const shortlist = await seedShortlists(org, res, demand);
  await seedInterviews(org, demand, shortlist);
  await seedEngagements(org, res, demand);
  await seedDuplicates(org, res, demand);
  await seedBrokerThreads(org, res, demand);
  await seedAudit(org, demand, shortlist);
  await seedSensitiveColumns();

  log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  log(`Demo tenants: client = Acme Finserv · vendor = Nimbus Softworks · ops = Priya Nair\n`);
}

main()
  .then(() => client.end({ timeout: 5 }))
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("\nSeed failed:\n", err);
    await client.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
