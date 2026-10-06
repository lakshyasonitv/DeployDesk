import { Shell, PageHeader, Scroll } from "@/src/lib/ui/Shell";
import { getDemoSession, getPortalSwitcherOptions } from "@/src/lib/auth/session";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { ShellAside } from "../../aside";
import { PostForm } from "./PostForm";

/** Client · Post a requirement. */
export const metadata = { title: "Post a requirement · Bench Exchange" };

export default async function NewRequirementPage() {
  const session = await getDemoSession("client");
  const switcher = await getPortalSwitcherOptions();
  const [aside, skills] = await Promise.all([
    ShellAside(session.orgId),
    db.select({ label: s.skills.label }).from(s.skills).where(eq(s.skills.isActive, true)),
  ]);

  return (
    <Shell portal="client" switcher={switcher} user={{ name: session.userName, org: session.orgName }} activeKey="requirements" asideTitle="OPEN REQS"
      asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Post a requirement"
        subtitle="Talentvibes sources from every supplier bench on the exchange. Suppliers never see your name."
      />
      <Scroll>
        <PostForm availableSkills={skills.map((x) => x.label).sort()} />
      </Scroll>
    </Shell>
  );
}
