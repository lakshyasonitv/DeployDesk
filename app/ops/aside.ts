import { getOpsDuplicates, getOpsPipeline } from "@/src/read-models/ops";
import { ACCENT } from "@/src/lib/ui/style";

/** Ops sidebar: today's queue and nav badges, both derived on read. */
export async function OpsAside() {
  const [pipeline, dupes] = await Promise.all([getOpsPipeline(), getOpsDuplicates()]);
  const openDupes = dupes.filter((d) => d.status === "open").length;
  const dueSoon = pipeline.requirements.filter((r) => r.sla.state === "warn").slice(0, 1)[0];

  return {
    items: [
      { label: `${openDupes} duplicate flag${openDupes === 1 ? "" : "s"} to clear`, dot: "#ef4444" },
      ...(dueSoon ? [{ label: `${dueSoon.code} ${dueSoon.sla.label.toLowerCase()}`, dot: ACCENT.ops }] : []),
      { label: `${pipeline.counts.matching ?? 0} requirements in matching`, dot: "#3f3f4a" },
    ],
    badges: {
      pipeline: pipeline.total,
      matching: pipeline.counts.matching || undefined,
      duplicates: openDupes || undefined,
    } as Record<string, string | number | undefined>,
    pipeline,
  };
}
