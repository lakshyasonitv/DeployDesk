import { Shell, PageHeader, Scroll, SectionLabel } from "@/src/lib/ui/Shell";
import { getDemoSession, getShellNav } from "@/src/lib/auth/session";
import { getVendorImports } from "@/src/read-models/vendor";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { eq } from "drizzle-orm";
import { s as css, sx, TOKENS } from "@/src/lib/ui/style";
import { VendorAside } from "../../aside";
import { AddResourceForm } from "./AddResourceForm";

/**
 * Vendor · Add bench resource + bulk upload.
 *
 * The reassurance panel and the "what the client sees" card are not decoration: they are
 * the product promise stated on the screen where a supplier hands over a real person's
 * name. Both are true because of how the schema is shaped — the client-facing table has
 * no name and no vendor column at all (ADR-009).
 */
export const metadata = { title: "Add bench resource · DeployDesk" };

export default async function AddResourcePage() {
  const session = await getDemoSession("vendor");
  const nav = await getShellNav(session);
  /**
   * Four independent reads, issued together.
   *
   * The comment this replaces said VendorAside "alone issues several queries" and that
   * fanning out exhausted the pool. Both halves are out of date: `VendorAside` is now a
   * single aggregate (`getVendorSidebar`), and the pool is `max: 10`, not 5.
   */
  const [aside, imports, skills, org] = await Promise.all([
    VendorAside(session.orgId),
    getVendorImports(session.orgId),
    db.select({ label: s.skills.label })
      .from(s.skills).where(eq(s.skills.isActive, true)),
    db.select({ name: s.organizations.name, code: s.organizations.publicCode })
      .from(s.organizations).where(eq(s.organizations.id, session.orgId)).limit(1),
  ]);

  const vendorName = org[0]?.name ?? "your company";
  const vendorCode = org[0]?.code ?? "";

  return (
    <Shell portal="vendor" identities={nav.identities} workspaces={nav.workspaces} user={{ name: session.userName, org: session.orgName }} activeKey="add" asideTitle="FRESHNESS ALERTS" asideItems={aside.items} badges={aside.badges}>
      <PageHeader
        title="Add bench resource"
        subtitle={`Listed as a masked profile. ${vendorName} is never exposed to a client.`}
      />
      <Scroll>
        <div style={css("display:grid;grid-template-columns:1.6fr 1fr;gap:18px;align-items:start")}>
          <AddResourceForm
            availableSkills={skills.map((x) => x.label).sort()}
            vendorName={vendorName}
            vendorCode={vendorCode}
          />

          <div style={css("display:flex;flex-direction:column;gap:14px")}>
            {/* bulk upload */}
            <div style={css("background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:15px")}>
              <div style={css("display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:10px")}>
                <SectionLabel>BULK UPLOAD</SectionLabel>
                <span style={sx("font-size:9px;font-weight:700;color:var(--t4)", { fontFamily: TOKENS.mono })}>CSV · XLSX</span>
              </div>

              <div style={css("border:2px dashed var(--ok-tint);background:var(--ok-tint);border-radius:10px;padding:18px;text-align:center")}>
                <div style={css("font-size:12.5px;font-weight:600;color:var(--teal)")}>
                  Drop your bench sheet here
                </div>
                <div style={css("font-size:11px;color:var(--teal);margin-top:4px")}>
                  or <span style={css("font-weight:700;text-decoration:underline")}>browse files</span> · max 500 rows
                </div>
              </div>

              <div style={sx("font-size:9.5px;color:var(--t4);margin-top:9px;line-height:1.6;word-break:break-word", { fontFamily: TOKENS.mono })}>
                name, emp_id, skills, exp_years, city, rate_inr, available_from
              </div>

              {imports ? (
                <>
                  <div style={css("margin-top:13px;padding-top:12px;border-top:1px solid var(--surface-3)")}>
                    <div style={css("font-size:11.5px;font-weight:700")}>
                      Last import · {imports.filename}
                    </div>
                    <div style={css("font-size:10.5px;color:var(--t4);margin-top:2px")}>
                      uploaded {imports.uploadedAgo}
                    </div>
                    <div style={css("display:flex;flex-direction:column;gap:5px;margin-top:9px")}>
                      {imports.summary.map((row, i) => (
                        <div key={row.label} style={css("display:flex;align-items:center;justify-content:space-between;gap:9px")}>
                          <span style={css("font-size:11.5px;color:var(--t2)")}>{row.label}</span>
                          <span style={sx("font-size:12px;font-weight:700", {
                            fontFamily: TOKENS.mono,
                            color: i === 2 && row.n > 0 ? "var(--warn)" : "var(--ok)",
                          })}>
                            {row.n}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {imports.reviewRows.length ? (
                    <div style={css("margin-top:12px;background:var(--warn-tint);border:1px solid var(--warn-tint);border-radius:9px;padding:11px")}>
                      <div style={css("font-size:11.5px;font-weight:700;color:var(--warn)")}>
                        {imports.reviewRows.length} rows need attention.
                      </div>
                      <div style={css("display:flex;flex-direction:column;gap:6px;margin-top:8px")}>
                        {imports.reviewRows.map((r) => (
                          <div key={r.rowNumber} style={css("font-size:11px;color:var(--warn);line-height:1.5")}>
                            <span style={{ fontFamily: TOKENS.mono }}>row {r.rowNumber}</span> ·{" "}
                            {r.name} — {r.issue}
                          </div>
                        ))}
                      </div>
                      {/* The duplicate counterpart is deliberately not named: saying which
                          resource it duplicates would name another supplier. */}
                      <div style={css("font-size:10px;color:var(--t4);margin-top:8px;line-height:1.5")}>
                        Where a profile is already represented on the exchange, Talentvibes resolves
                        it with both suppliers. We do not say who the other submission belongs to.
                      </div>
                      <div style={css("display:flex;gap:7px;margin-top:10px")}>
                        <div style={css("padding:7px 12px;border-radius:8px;font-size:11.5px;font-weight:700;background:var(--t1);color:var(--surface)")}>
                          Review {imports.reviewRows.length} rows
                        </div>
                        <div style={css("padding:7px 12px;border:1px solid var(--border-2);border-radius:8px;font-size:11.5px;font-weight:600;background:var(--surface)")}>
                          Template
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            {/* what the client sees */}
            <div style={css("background:var(--t1);border-radius:12px;padding:15px;color:var(--surface)")}>
              <div style={sx("font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--t4)", { fontFamily: TOKENS.mono })}>
                WHAT THE CLIENT SEES
              </div>

              <div style={css("background:var(--t1);border:1px solid var(--border);border-radius:10px;padding:12px;margin-top:11px")}>
                <div style={css("display:flex;align-items:flex-start;justify-content:space-between;gap:9px")}>
                  <div>
                    <div style={sx("font-size:14px;font-weight:700;letter-spacing:-.4px", { fontFamily: TOKENS.mono })}>
                      TV-####
                    </div>
                    <div style={css("font-size:10.5px;color:var(--t4);margin-top:2px")}>6.3y · Pune</div>
                  </div>
                  <div style={css("text-align:right")}>
                    <div style={css("font-size:17px;font-weight:800;color:var(--t4);line-height:1")}>—</div>
                    <div style={sx("font-size:8px;font-weight:700;letter-spacing:.1em;color:var(--t4);margin-top:3px", { fontFamily: TOKENS.mono })}>
                      PENDING TEST
                    </div>
                  </div>
                </div>
                <div style={css("display:flex;gap:4px;margin-top:9px")}>
                  {["Java Spring Boot", "PostgreSQL"].map((sk) => (
                    <span key={sk} style={css("padding:2px 7px;background:var(--border);border-radius:5px;font-size:10px;font-weight:600;color:var(--t2)")}>
                      {sk}
                    </span>
                  ))}
                </div>
                <div style={css("margin-top:10px;padding-top:9px;border-top:1px dashed var(--border);font-size:10.5px;color:var(--t4);line-height:1.6")}>
                  Rate shown to the client is a band set by Talentvibes.
                </div>
              </div>

              <div style={css("font-size:10.5px;color:var(--t4);margin-top:11px;line-height:1.6")}>
                Withheld from the client: the name, any photo, and {vendorName}. The exact rate you
                set is never shown either — the client sees a coarse band derived from the price
                Talentvibes quotes them, not from your cost.
              </div>
            </div>
          </div>
        </div>
      </Scroll>
    </Shell>
  );
}
