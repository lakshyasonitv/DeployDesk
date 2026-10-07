import { Shell, PageHeader, Scroll } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { ShellAside } from "../../aside";
import { PostForm } from "./PostForm";

/** Client · Post a requirement. */
export const metadata = { title: "Post a new role · DeployDesk" };

export default async function NewRequirementPage() {
  const session = await getDemoSession("client");
  const nav = await getShellNav(session);
  const [aside, skills] = await Promise.all([
    ShellAside(session.orgId),
    db.select({ label: s.skills.label }).from(s.skills).where(eq(s.skills.isActive, true)),
  ]);

  return (
    <Shell portal="client" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="requirements" asideTitle="OPEN REQS"
      asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Post a new role"
        subtitle="Tell us what you need. We look across every supplier we work with, and none of them sees your company name."
      />
      <Scroll>
        <PostForm availableSkills={skills.map((x) => x.label).sort()} />
      </Scroll>
    </Shell>
  );
}
