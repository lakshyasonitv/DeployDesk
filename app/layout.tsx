import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Every route reads from Postgres. Without this, Next 15 prerenders server components
 * at build time: the build either fails because the database is unreachable from CI, or
 * succeeds and bakes the data in, so re-seeding changes nothing in the deployed app.
 */
export const dynamic = "force-dynamic";

/**
 * Run the functions in the same region as the database.
 *
 * The Supabase project is in ap-south-1 (Mumbai), so the functions run in bom1.
 *
 * This is worth keeping aligned. The project was originally in ap-southeast-2 (Sydney),
 * where a warm query measured ~410ms from India and opening a connection cost ~3s of
 * TLS handshake. Moving the database to Mumbai took the same warm query to ~30ms and the
 * full seed from 41.7s to 4.7s. If the Supabase project ever moves region again, change
 * this with it — co-location is where nearly all of that gain comes from.
 */
export const preferredRegion = ["bom1"];

export const metadata: Metadata = {
  title: "Bench Exchange · Talentvibes",
  description: "Brokered marketplace for IT bench capacity",
};

// Fonts and the global reset are taken from the design handoff's own helmet block.
const GLOBAL_CSS = `
  body { margin: 0; background: #f7f7f9; font-family: Manrope, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  * { box-sizing: border-box; }
  a { color: #6d3ff0; text-decoration: none; }
  a:hover { color: #5a2fd0; }
  ::-webkit-scrollbar { width: 9px; height: 9px; }
  ::-webkit-scrollbar-thumb { background: #d8d8e2; border-radius: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      </head>
      <body style={{ color: "#101014" }}>{children}</body>
    </html>
  );
}
