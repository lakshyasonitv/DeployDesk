import { getVendorSidebar } from "@/src/read-models/vendor";

/**
 * The vendor sidebar's freshness alerts and nav badges — derived on read.
 *
 * Backed by getVendorSidebar(), a single COUNT query. It used to call getVendorRoster(),
 * which loads all 132 resources with their skills and assessments, and which the roster
 * page then loaded a second time.
 */
export async function VendorAside(vendorOrgId: string) {
  return getVendorSidebar(vendorOrgId);
}
