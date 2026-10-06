import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Shell } from "@/src/lib/ui/Shell";
import { getDemoSession, getPortalSwitcherOptions } from "@/src/lib/auth/session";
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
  const switcher = await getPortalSwitcherOptions();

  const workspace = await getOpsMatchingWorkspace(code.toUpperCase());
  if (!workspace) notFound();

  // Sequential: OpsAside alone issues several queries, and running it alongside others
  // exhausted the connection pool. See src/read-models/ops/index.ts.
  const aside = await OpsAside();
  // The requirement picker needs the list; the sidebar no longer fetches it.
  const pipeline = await getOpsPipeline();
  const dupes = await getOpsDuplicates();
  const benchRows = (await db.execute<{ n: number }>(
    sql`select count(*)::int as n from organizations where org_type = 'vendor'`,
  )) as unknown as Array<{ n: number }>;

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
    <Shell portal="ops" switcher={switcher} user={{ name: session.userName, org: `${session.orgName} · ${session.role}` }} activeKey="matching" asideTitle="TODAY'S QUEUE"
      asideItems={aside.items} badges={aside.badges}>
      <Workspace
        requirement={workspace.requirement}
        weights={workspace.weights}
        candidates={workspace.candidates}
        duplicateCount={touching}
        pickerOptions={pickerOptions}
        benchCount={Number(benchRows[0]?.n ?? 0)}
      />
    </Shell>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return { title: `Matching ${code.toUpperCase()} · DeployDesk` };
}
