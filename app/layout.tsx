import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Manrope, JetBrains_Mono } from "next/font/google";

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

/**
 * Fonts are self-hosted through next/font rather than linked from fonts.googleapis.com.
 *
 * The design handoff's own helmet block used a stylesheet <link>, which costs a DNS
 * lookup, a TLS handshake and a round trip to a third-party host before any text can
 * paint — on the critical path of every cold load. next/font downloads the files at build
 * time, serves them from this origin, and emits font-display: swap with a size-adjusted
 * fallback so there is no layout shift when the real face arrives.
 *
 * The weights are exactly the ones the design uses; asking for fewer bytes than the full
 * family is the point.
 */
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-manrope",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "DeployDesk by Talentvibes",
  description: "Brokered marketplace for IT bench capacity",
};

// Fonts and the global reset are taken from the design handoff's own helmet block.
const GLOBAL_CSS = `
  body { margin: 0; background: #f7f7f9; font-family: var(--font-manrope), Manrope, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  * { box-sizing: border-box; }
  a { color: #6d3ff0; text-decoration: none; }
  a:hover { color: #5a2fd0; }
  ::-webkit-scrollbar { width: 9px; height: 9px; }
  ::-webkit-scrollbar-thumb { background: #d8d8e2; border-radius: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  @keyframes tv-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${jetbrainsMono.variable}`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      </head>
      <body style={{ color: "#101014" }}>{children}</body>
    </html>
  );
}
