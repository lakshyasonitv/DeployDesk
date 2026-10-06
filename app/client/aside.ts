import { getClientOverview } from "@/src/read-models/client";
import { ACCENT } from "@/src/lib/ui/style";

/**
 * The client sidebar's context aside and nav badges. Both are derived on read —
 * docs/DOMAIN.md lists nav badges and column counts as values that must never be stored.
 */
export async function ShellAside(clientOrgId: string) {
  const overview = await getClientOverview(clientOrgId, "Ananya Krishnan");

  const items = overview.openRequirements.slice(0, 3).map((r, i) => ({
    label: `${r.code} · ${shortRole(r.roleTitle)} ×${r.quantity}`,
    dot: i === 0 ? ACCENT.client : "#3f3f4a",
  }));

  return {
    items,
    badges: {
      requirements: overview.stats.openRequirements || undefined,
      shortlists: overview.stats.awaitingReview || undefined,
      interviews: overview.stats.inInterview || undefined,
      engagements: overview.stats.activeEngagements || undefined,
    } as Record<string, string | number | undefined>,
  };
}

/** "Senior React Engineers" -> "React"; keeps the sidebar single-line. */
function shortRole(role: string): string {
  const words = role.replace(/^Senior\s+/i, "").split(/\s+/);
  const head = words.filter((w) => !/engineers?|developers?|consultants?|lead|admin/i.test(w));
  return (head.length ? head : words).slice(0, 2).join(" ");
}
