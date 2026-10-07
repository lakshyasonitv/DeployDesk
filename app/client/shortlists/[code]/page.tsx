import { Shell, EmptyState } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getClientShortlist, getClientBrokerThread } from "@/src/read-models/client";
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
  const nav = await getShellNav(session);

  // Tenancy is enforced inside the read model: it filters on client_org_id, so a
  // requirement belonging to another client simply does not exist from here.
  /**
   * The broker thread is fetched, not invented.
   *
   * The Ask panel used to seed itself with one hardcoded opening message written in the
   * component, while real messages sat in `broker_messages` unread. For a dual-role
   * organisation that matters more than cosmetics: "one thread per workspace, never mixed"
   * cannot hold if the thread is a literal in the client bundle.
   *
   * `getClientBrokerThread` filters `side = 'client'`, which is the discriminator that
   * keeps a dual-role org's hiring conversation separate from its bench one — both carry
   * the same `counterparty_org_id`.
   */
  const [view, aside, thread] = await Promise.all([
    getClientShortlist(session.orgId, code.toUpperCase()),
    ShellAside(session.orgId),
    getClientBrokerThread(session.orgId, code.toUpperCase()),
  ]);

  if (!view) {
    return (
      <Shell portal="client" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="shortlists" asideTitle="OPEN REQS" asideItems={aside.items} badges={aside.badges}>
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
      portal="client" identities={nav.identities} workspaces={nav.workspaces}
      user={{ name: session.userName, org: session.orgName }}
      activeKey="shortlists"
      asideTitle="OPEN REQS"
      asideItems={aside.items}
      badges={aside.badges}
    >
      <ShortlistBoard view={view} thread={thread} />
    </Shell>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return { title: `Shortlist ${code.toUpperCase()} · DeployDesk` };
}
