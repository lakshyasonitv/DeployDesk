import { getOpsSidebar } from "@/src/read-models/ops";

/**
 * The ops sidebar's queue and nav badges — derived on read.
 *
 * Backed by getOpsSidebar(), ONE query. It used to call getOpsPipeline() and
 * getOpsDuplicates(), which on /ops/margin was 9 of the page's 10 queries and 94% of its
 * data time. Pages that genuinely need the pipeline now fetch it themselves.
 */
export async function OpsAside() {
  return getOpsSidebar();
}
