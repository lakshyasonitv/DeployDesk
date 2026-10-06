import { Shell } from "@/src/lib/ui/Shell";
import { getDemoSession, getPortalSwitcherOptions } from "@/src/lib/auth/session";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { eq, sql } from "drizzle-orm";
import { getOpsPipeline } from "@/src/read-models/ops";
import { OpsAside } from "./aside";
import { PipelineBoard } from "./PipelineBoard";

export const metadata = { title: "Pipeline · DeployDesk" };

export default async function OpsPipelinePage() {
  const session = await getDemoSession("ops");
  const switcher = await getPortalSwitcherOptions();
  const aside = await OpsAside();
  // The board needs the full pipeline; the sidebar no longer fetches it.
  const pipeline = await getOpsPipeline();

  const [counts] = await db.execute<{ clients: number; vendors: number }>(sql`
    select
      (select count(*) from organizations where org_type = 'client')::int as clients,
      (select count(*) from organizations where org_type = 'vendor')::int as vendors
  `) as unknown as Array<{ clients: number; vendors: number }>;

  return (
    <Shell portal="ops" switcher={switcher} user={{ name: session.userName, org: `${session.orgName} · ${session.role}` }} activeKey="pipeline" asideTitle="TODAY'S QUEUE"
      asideItems={aside.items} badges={aside.badges}>
      <PipelineBoard
        requirements={pipeline.requirements}
        ownerShortSelf="P. Nair"
        clientCount={Number(counts.clients)}
        vendorCount={Number(counts.vendors)}
      />
    </Shell>
  );
}
