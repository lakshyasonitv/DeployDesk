import { notFound } from "next/navigation";
import { Shell, EmptyState } from "@/src/lib/ui/Shell";
import { getDemoSession, getPortalSwitcherOptions } from "@/src/lib/auth/session";
import { getClientShortlist } from "@/src/read-models/client";
import { ShellAside } from "../../aside";
import { ShortlistBoard } from "./ShortlistBoard";

/**
 * Client · Shortlist review — the hero screen.
 *
 * Server component. Resolves the caller's org, reads ONLY through the client read model,
 * and hands plain JSON to the client component. Nothing unmasked reaches the browser
 * because nothing unmasked is fetched here.
 */
export default async function ShortlistPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const session = await getDemoSession("client");
  const switcher = await getPortalSwitcherOptions();

  // Tenancy is enforced inside the read model: it filters on client_org_id, so a
  // requirement belonging to another client simply does not exist from here.
  const view = await getClientShortlist(session.orgId, code.toUpperCase());
  const aside = await ShellAside(session.orgId);

  if (!view) {
    return (
      <Shell portal="client" switcher={switcher} user={{ name: session.userName, org: session.orgName }} activeKey="shortlists" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
        <div style={{ padding: "26px" }}>
          <EmptyState>
            No shortlist has been sent for {code.toUpperCase()} yet. Your broker will deliver
            masked profiles here.
          </EmptyState>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      portal="client" switcher={switcher}
      user={{ name: session.userName, org: session.orgName }}
      activeKey="shortlists"
      asideTitle="OPEN REQS"
      asideItems={aside.items}
      badges={aside.badges}
    >
      <ShortlistBoard view={view} />
    </Shell>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return { title: `Shortlist ${code.toUpperCase()} · DeployDesk` };
}
