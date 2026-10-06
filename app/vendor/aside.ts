import { getVendorRoster } from "@/src/read-models/vendor";

/**
 * The vendor sidebar's freshness alerts and nav badges — derived on read, never stored.
 */
export async function VendorAside(vendorOrgId: string) {
  const { counts, total, resources } = await getVendorRoster(vendorOrgId);
  const pendingTests = resources.filter((r) => r.assessment.status !== "scored").length;

  return {
    items: [
      { label: `${counts.expiring} profiles expire within 4 days`, dot: "#f59e0b" },
      { label: `${counts.unconfirmed} unconfirmed over 14 days`, dot: "#ef4444" },
      { label: `${pendingTests} assessments pending`, dot: "#3f3f4a" },
    ],
    badges: {
      roster: total,
      assessments: pendingTests || undefined,
    } as Record<string, string | number | undefined>,
  };
}
