import { Shell } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { db } from "@/src/db/client";
import { sql } from "drizzle-orm";
import { getOpsPipeline } from "@/src/read-models/ops";
import { OpsAside } from "./aside";
import { PipelineBoard } from "./PipelineBoard";

export const metadata = { title: "Role pipeline · DeployDesk" };

export default async function OpsPipelinePage() {
  const session = await getDemoSession("ops");
  // Independent reads, so one round trip instead of four sequential ones.
  // The board needs the full pipeline; the sidebar no longer fetches it.
  const [nav, aside, pipeline, countRows] = await Promise.all([
    getShellNav(session),
    OpsAside(),
    getOpsPipeline(),
    db.execute(sql`
      -- Capabilities, not org_type: org_type collapses a dual-role company to 'vendor', so
      -- Cygnet counted as a supplier and never as a hiring company.
      select
        (select count(*) from org_capabilities where can_hire)::int   as clients,
        (select count(*) from org_capabilities where can_supply)::int as vendors
    `),
  ]);
  const [counts] = countRows as unknown as Array<{ clients: number; vendors: number }>;

  return (
    <Shell portal="ops" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="pipeline" asideTitle="TODAY'S QUEUE"
      asideItems={aside.items} badges={aside.badges}>
      <PipelineBoard
        requirements={pipeline.requirements}
        clientCount={Number(counts.clients)}
        vendorCount={Number(counts.vendors)}
      />
    </Shell>
  );
}
