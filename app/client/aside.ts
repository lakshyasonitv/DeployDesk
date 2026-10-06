import { getClientSidebar } from "@/src/read-models/client";
import { ACCENT } from "@/src/lib/ui/style";

/**
 * The client sidebar's context aside and nav badges — derived on read.
 * docs/DOMAIN.md lists nav badges and column counts as values that must never be stored.
 *
 * Backed by getClientSidebar(), a pair of COUNT queries. It used to call
 * getClientOverview(), which every client page already calls, doubling each page's
 * queries to produce four badge numbers.
 */
export async function ShellAside(clientOrgId: string) {
  const sidebar = await getClientSidebar(clientOrgId);

  return {
    items: sidebar.items.map((r, i) => ({
      label: `${r.code} · ${shortRole(r.roleTitle)} ×${r.quantity}`,
      dot: i === 0 ? ACCENT.client : "var(--t4)",
    })),
    badges: sidebar.badges,
  };
}

/** "Senior React Engineers" -> "React"; keeps the sidebar single-line. */
function shortRole(role: string): string {
  const words = role.replace(/^Senior\s+/i, "").split(/\s+/);
  const head = words.filter((w) => !/engineers?|developers?|consultants?|lead|admin/i.test(w));
  return (head.length ? head : words).slice(0, 2).join(" ");
}
