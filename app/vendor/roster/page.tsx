import { Shell } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getVendorRoster } from "@/src/read-models/vendor";
import { VendorAside } from "../aside";
import { RosterTable } from "./RosterTable";

/**
 * Vendor · Bench roster.
 *
 * The vendor sees its OWN resources: real names, own employee codes, own rates. The
 * read model is scoped to the caller's vendorOrgId, so another supplier's bench is not
 * reachable from here — asserted by a leak test.
 */
export const metadata = { title: "Bench roster · DeployDesk" };

export default async function RosterPage() {
  const session = await getDemoSession("vendor");
  const nav = await getShellNav(session);
  const [{ resources, counts, total }, aside] = await Promise.all([
    getVendorRoster(session.orgId),
    VendorAside(session.orgId),
  ]);

  return (
    <Shell
      portal="vendor" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }}
      activeKey="roster"
      asideTitle="NEEDS CONFIRMING"
      asideItems={aside.items}
      badges={aside.badges}
    >
      <RosterTable resources={resources} counts={counts} total={total} />
    </Shell>
  );
}
