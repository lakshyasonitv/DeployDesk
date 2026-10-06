import { redirect } from "next/navigation";
import { getOpsPipeline } from "@/src/read-models/ops";

/** /ops/matching with no requirement: open the first one in matching. */
export default async function MatchingIndex() {
  const pipeline = await getOpsPipeline();
  const first =
    pipeline.requirements.find((r) => r.stage === "matching") ??
    pipeline.requirements.find((r) => r.stage === "shortlisted") ??
    pipeline.requirements[0];
  redirect(first ? `/ops/matching/${first.code}` : "/ops");
}
