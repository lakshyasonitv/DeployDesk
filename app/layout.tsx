import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

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
 * The v2 handoff asks for Plus Jakarta Sans (UI) and IBM Plex Mono (IDs, key hints, CSV
 * snippets) and suggests `next/font/google`, which is what this is — but downloaded at
 * build time and served from this origin rather than fetched from a third party. A
 * stylesheet <link> to fonts.googleapis.com would cost a DNS lookup, a TLS handshake and
 * a round trip before any text could paint, on the critical path of every cold load.
 * next/font also emits font-display: swap with a size-adjusted fallback, so there is no
 * layout shift when the real face arrives.
 *
 * The weights are exactly the ones DESIGN_TOKENS.md uses — 400-800 for the UI face and
 * 400-600 for mono. Asking for fewer bytes than the full family is the point.
 *
 * `variable` feeds --font-sans / --font-mono, which app/globals.css declares with the
 * literal family names as a fallback.
 */
const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "DeployDesk by Talentvibes",
  description: "Brokered marketplace for IT bench capacity",
};

/**
 * Applies the stored theme before first paint.
 *
 * This has to be a blocking inline script in <head>. The alternative — reading
 * localStorage from a useEffect — runs after hydration, so a user who chose dark would
 * see a white flash on every navigation. There is no server-side way to know the choice:
 * localStorage is not sent with the request.
 *
 * Wrapped in try/catch because localStorage throws outright in a private window or with
 * site data blocked, and a theme preference is not worth a blank page.
 */
const THEME_INIT = `
try {
  var t = localStorage.getItem("tvbx-theme");
  if (t === "dark" || t === "light") document.documentElement.setAttribute("data-tvtheme", t);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
