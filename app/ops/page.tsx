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
  const nav = await getShellNav(session);
  const aside = await OpsAside();
  // The board needs the full pipeline; the sidebar no longer fetches it.
  const pipeline = await getOpsPipeline();

  const [counts] = await db.execute<{ clients: number; vendors: number }>(sql`
    select
      (select count(*) from organizations where org_type = 'client')::int as clients,
      (select count(*) from organizations where org_type = 'vendor')::int as vendors
  `) as unknown as Array<{ clients: number; vendors: number }>;

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
