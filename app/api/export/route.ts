import { z } from "zod";
import { getDemoSession } from "@/src/lib/auth/session";
import { getVendorEarnings } from "@/src/read-models/vendor";
import { getClientOverview } from "@/src/read-models/client";
import { getOpsMargin } from "@/src/read-models/ops";

/**
 * GET /api/export?kind=vendor-earnings  → a CSV download.
 *
 * ---------------------------------------------------------------------------
 * BUILT FROM THE SAME READ MODEL THE SCREEN USES
 * ---------------------------------------------------------------------------
 *
 * Every export here calls the function that renders the corresponding page. That is the
 * whole design: a finance team reconciling a spreadsheet against a screen must not find
 * two different numbers, and the only way to guarantee that is to have one source. An
 * export with its own queries is an export that drifts the first time a filter changes.
 *
 * It also means masking is inherited rather than re-implemented. A vendor's CSV cannot
 * contain a client name or a margin, because `getVendorEarnings` cannot return one — not
 * because this file remembers to strip it.
 *
 * ---------------------------------------------------------------------------
 * WHY CSV AND NOT XLSX
 * ---------------------------------------------------------------------------
 *
 * The audience opens these in Excel, and Excel opens CSV. A real .xlsx needs a library and
 * a binary writer for no benefit a finance team would notice.
 */

const Query = z.object({
  kind: z.enum(["vendor-earnings", "client-engagements", "ops-margin"]),
});

/**
 * One CSV field.
 *
 * Quotes anything containing a comma, quote or newline, and doubles inner quotes — RFC 4180.
 * The leading-character guard is the part people forget: a value starting with `=`, `+`, `-`
 * or `@` is executed as a formula by Excel, so `=1+1` in a company name becomes a live cell
 * and a crafted one can exfiltrate data. Prefixing a single quote neutralises it.
 */
function field(value: unknown): string {
  if (value === null || value === undefined) return "";
  let v = String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(field).join(","), ...rows.map((r) => r.map(field).join(","))];
  // CRLF and a UTF-8 BOM: Excel on Windows misreads ₹ and other non-ASCII without the BOM,
  // and this product's figures are full of them.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // An export is a snapshot of now; never let a proxy hand back yesterday's.
      "cache-control": "no-store",
    },
  });
}

/** `2026-10-07` — stable, sortable, and unambiguous between India and the US. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({ kind: url.searchParams.get("kind") });
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  /* ------------------------------------------------- vendor: earnings ---- */

  if (parsed.data.kind === "vendor-earnings") {
    const session = await getDemoSession("vendor");
    const e = await getVendorEarnings(session.orgId);

    // Column names are the vendor's own vocabulary. "Your rate" and not "vendor rate",
    // because from where they sit it is simply their rate. `fullName` is their own
    // employee, which they are entitled to — the masked id is there so a figure can be
    // matched back to what Talentvibes quotes them.
    // `monthLabel` is THIS MONTH'S BILLED AMOUNT, not a month name — it comes from the
    // invoice line, falling back to the full rate when there is no line yet. An earlier
    // version of this header said "Month" and put a rupee figure under it.
    const csv = toCsv(
      ["Reference", "Name", "Role", "Working since", "Your monthly rate", "Billed this month", "Status"],
      e.rows.map((r) => [
        r.maskedId, r.fullName, r.roleTitle, r.since, r.rateLabel, r.monthLabel, r.status,
      ]),
    );
    return csvResponse(`deploydesk-earnings-${today()}.csv`, csv);
  }

  /* -------------------------------------------- client: people working ---- */

  if (parsed.data.kind === "client-engagements") {
    const session = await getDemoSession("client");
    const o = await getClientOverview(session.orgId, session.userName);

    // `rateLabel` is what the client is charged. There is no supplier column and no vendor
    // rate to put in one — the read model has neither.
    const csv = toCsv(
      ["Reference", "Role", "Since", "Status", "Your rate"],
      o.engagements.map((g) => [g.maskedId, g.roleTitle, g.sinceLabel, g.status, g.rateLabel]),
    );
    return csvResponse(`deploydesk-people-working-${today()}.csv`, csv);
  }

  /* ----------------------------------------------------- ops: margin ---- */

  /**
   * Resolving the ops session IS the guard: `getDemoSession("ops")` throws unless the
   * caller's organisation is the broker, so this line is why a client cannot fetch the
   * margin export by guessing the URL. It is not an unused variable.
   */
  await getDemoSession("ops");
  const m = await getOpsMargin();

  /**
   * The only export that contains a spread, and the only one whose route is gated on the
   * ops portal. If this file ever grows a fourth export, check which session it resolves
   * before deciding what it may include.
   */
  const csv = toCsv(
    ["Reference", "Name", "Role", "Supplier", "Vendor rate", "Client rate", "Spread", "Margin %", "Status", "Below floor"],
    m.rows.map((r) => [
      r.maskedId, r.fullName, r.roleTitle, r.vendorName,
      r.vendorRateLabel, r.clientRateLabel, r.spreadLabel, r.pctLabel,
      r.status, r.exception ? "yes" : "no",
    ]),
  );
  return csvResponse(`deploydesk-margin-${today()}.csv`, csv);
}
