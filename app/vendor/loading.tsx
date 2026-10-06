import { ShellSkeleton } from "@/src/lib/ui/Skeleton";

/**
 * Rendered instantly by Next on navigation into any /vendor route, while the server
 * component's queries run. Without it a click left the previous page on screen and the
 * app looked frozen for the duration.
 */
export default function Loading() {
  return <ShellSkeleton portal="vendor" />;
}
