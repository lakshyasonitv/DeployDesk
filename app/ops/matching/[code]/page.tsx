import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Shell } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getOpsMatchingWorkspace, getOpsPipeline, getOpsDuplicates } from "@/src/read-models/ops";
import { db } from "@/src/db/client";
import { OpsAside } from "../../aside";
import { Workspace } from "./Workspace";

/**
 * Ops · Matching workspace. Unmasked by design — ops is the only portal that may see
 * real names, supplier identity, vendor rates and the margin at the proposed rate.
 */
export default async function MatchingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await getDemoSession("ops");
  const nav = await getShellNav(session);

  /**
   * Five independent reads, issued together. This was the slowest page in the app at
   * ~1.0s, almost all of it spent waiting on round trips one at a time.
   *
   * It used to carry this comment: "Sequential: OpsAside alone issues several queries,
   * and running it alongside others exhausted the connection pool." That was true when
   * written and is not any more — two things changed underneath it. `OpsAside()` is now
   * ONE count query (Sprint 2 stopped it calling getOpsPipeline + getOpsDuplicates to
   * render three badges), and the pool went from 5 to `max: 10`. A stale comment was the
   * only thing holding the serial shape in place, which is worth remembering: a note
   * explaining why something is slow needs re-checking when its reason is fixed.
   */
  const [workspace, aside, pipeline, dupes, benchRows] = await Promise.all([
    getOpsMatchingWorkspace(code.toUpperCase()),
    OpsAside(),
    // The requirement picker needs the list; the sidebar no longer fetches it.
    getOpsPipeline(),
    getOpsDuplicates(),
    db.execute<{ n: number }>(
      sql`select count(*)::int as n from organizations where org_type = 'vendor'`,
    ) as unknown as Promise<Array<{ n: number }>>,
  ]);

  if (!workspace) notFound();

  // Which duplicate flags touch this requirement's pool.
  const poolIds = new Set(workspace.candidates.map((c) => c.maskedId));
  const touching = dupes.filter(
    (d) => d.blocks && d.sides.some((side) => side && poolIds.has(side.maskedId)),
  ).length;

  const pickerOptions = pipeline.requirements
    .filter((r) => ["new", "matching", "shortlisted"].includes(r.stage))
    .map((r) => ({
      code: r.code, roleTitle: r.roleTitle, clientName: r.clientName,
      quantity: r.quantity, ownerShort: r.ownerShort, stage: r.stage,
      slaLabel: r.sla.label, slaState: r.sla.state,
    }));

  return (
    <Shell portal="ops" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="matching" asideTitle="TODAY'S QUEUE"
      asideItems={aside.items} badges={aside.badges}>
      <Workspace
        requirement={workspace.requirement}
        weights={workspace.weights}
        candidates={workspace.candidates}
        duplicateCount={touching}
        pickerOptions={pickerOptions}
        benchCount={Number(benchRows[0]?.n ?? 0)}
        ownBenchMatches={workspace.ownBenchMatches}
        refusedByRules={workspace.refusedByRules}
      />
    </Shell>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return { title: `Matching ${code.toUpperCase()} · DeployDesk` };
}
