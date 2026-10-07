"use client";

import { useEffect, useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { s, sx } from "./style";
import type { Portal } from "./Shell";

/**
 * "How this works", behind the `?` button.
 *
 * The product owner chose this over the ⌘K palette, and the reasoning is worth keeping:
 * the audience is senior people with years of experience who do not want a steep learning
 * curve. A keyboard shortcut is a thing to memorise. An explanation of the model is a thing
 * you read once and then understand the whole product.
 *
 * So the copy below is the brokered model in plain English, written per portal — a client
 * does not need to be told how the supplier side works, and telling them would be a
 * masking problem in itself. Each panel says what the reader sees, what they do not, and
 * why, because "why" is what stops someone asking for the supplier's name.
 *
 * It is deliberately NOT a tour or a carousel. One screen, closed in one click, reopenable
 * from the same button.
 */

interface Section {
  heading: string;
  body: string;
}

/**
 * The copy, per portal.
 *
 * Kept here rather than in a read model because it is static presentation text — and
 * because anything the shell imports from `src/read-models/` drags the Postgres driver into
 * the browser bundle, which has already broken one build.
 */
const CONTENT: Record<Portal, { title: string; intro: string; sections: Section[] }> = {
  client: {
    title: "How Talentvibes works",
    intro:
      "You tell us what you need. We find people from supplier companies you never have to "
      + "deal with, and you contract with us — not with them.",
    sections: [
      {
        heading: "You post a role",
        body: "Say what the work is, what you can pay, and where. We start looking the same "
          + "working day. No supplier ever sees your company name.",
      },
      {
        heading: "We send you a shortlist",
        body: "Each person arrives as a code like TV-4821, with their skills, experience, "
          + "city and an independently supervised test score. You will not see their name, "
          + "their photo, or which company they work for. That is deliberate: it is what "
          + "stops the supplier and you cutting each other's terms.",
      },
      {
        heading: "You see a rate range, not a price list",
        body: "Each profile shows a band, like ₹1.7L–2.1L a month. It is what the person "
          + "would cost you, rounded. You never see what we pay the supplier, and the "
          + "supplier never sees what you pay us.",
      },
      {
        heading: "You pick who to meet",
        body: "Select the people you want to interview and we arrange it — we issue the "
          + "meeting link and brief the candidate. Your panel never contacts the supplier.",
      },
      {
        heading: "One contract, one invoice",
        body: "Everyone you hire this way is contracted through Talentvibes. However many "
          + "suppliers the people came from, you deal with us.",
      },
      {
        heading: "Your broker",
        body: "A named person at Talentvibes owns your account. Anything you ask on a "
          + "shortlist goes to them and to nobody else — not to the supplier, and never "
          + "with your name attached.",
      },
    ],
  },

  vendor: {
    title: "How Talentvibes works",
    intro:
      "You list the people on your bench. We place them with companies you never have to "
      + "find, pitch to, or chase for payment.",
    sections: [
      {
        heading: "You list your bench",
        body: "Add each person once with their skills, experience, city and your monthly "
          + "rate. We give them a code like TV-4821, and that code is all a client ever "
          + "sees — never their name, and never your company name.",
      },
      {
        heading: "Keep them marked as free",
        body: "A profile has to be confirmed as still available every 10 days. After 14 it "
          + "stops being offered to anyone. One click on “Still free” is enough, and the "
          + "roster shows you who is due.",
      },
      {
        heading: "A test score gets people picked",
        body: "Scores come from an independent proctored test. You cannot change them — "
          + "which is exactly why a client trusts them, and why scored profiles are "
          + "shortlisted far more often than unscored ones.",
      },
      {
        heading: "Your rate is your rate",
        body: "What you enter is what Talentvibes pays you. You will never see what the "
          + "client is charged, and they never see your figure. The difference is our fee "
          + "for finding the work, doing the contracts and carrying the payment risk.",
      },
      {
        heading: "We deal with the client",
        body: "Interviews, feedback, scheduling and billing all come through us. You are "
          + "never asked to speak to the client, and you are never told who they are.",
      },
      {
        heading: "You invoice us",
        body: "One payable invoice a month covering everyone you have placed, whoever they "
          + "are working for.",
      },
    ],
  },

  ops: {
    title: "The brokering desk",
    intro:
      "Talentvibes is the only party that sees both sides. Everything on these screens is "
      + "internal, and most of it would be a breach of the product's core promise if it "
      + "reached either party.",
    sections: [
      {
        heading: "You are the only one who sees both sides",
        body: "A client never learns who the supplier is. A supplier never learns who the "
          + "client is. Neither ever sees the margin. That is not a setting — it is the "
          + "reason the business exists, and it is enforced in the data each portal can "
          + "read, not in what the screens choose to show.",
      },
      {
        heading: "Roles move through the pipeline",
        body: "New, matching, shortlisted, interviewing, placed. Each stage has a promise "
          + "attached, counted in business hours — 09:00 to 19:00 IST, Monday to Saturday. "
          + "A role waiting on a client is marked idle, not late: an unresponsive client "
          + "must not make a broker look slow.",
      },
      {
        heading: "The matching desk ranks, you decide",
        body: "The score is a weighted blend of skills, test result, experience fit, rate, "
          + "freshness and supplier reliability. Reorder it whenever your judgement differs "
          + "— an override is recorded as one.",
      },
      {
        heading: "Some candidates are refused for you",
        body: "A company on both sides of the exchange is never offered its own people, nor "
          + "anyone from a company in the same declared group. Blocked pairings are hidden "
          + "in both directions. The rule runs in the database as well as in the query, so "
          + "an application bug cannot get past it.",
      },
      {
        heading: "Duplicates are flagged before a shortlist goes out",
        body: "The same person submitted by two suppliers has to be settled first. Keeping "
          + "one withdraws the other — offering a client the same person twice through two "
          + "suppliers is how they find out about each other.",
      },
      {
        heading: "Margin is yours alone",
        body: "The margin screen is the only place a spread appears. A company that both "
          + "supplies and hires is put on a declared fee instead of a hidden markup, "
          + "because it could otherwise compare its two statements and work the spread out.",
      },
    ],
  },
};

export function HowItWorks({ portal }: { portal: Portal }) {
  const [open, setOpen] = useState(false);
  const content = CONTENT[portal];

  // Escape closes it, which is what anyone tries first.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="How Talentvibes works"
        aria-label="How Talentvibes works"
        style={s("width:32px;height:30px;border:1px solid var(--border);border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--t3);flex:none;background:var(--surface);cursor:pointer;font-family:inherit")}
      >
        <HelpCircle size={15} strokeWidth={1.75} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={content.title}
          onClick={() => setOpen(false)}
          style={s("position:fixed;inset:0;background:rgba(15,23,41,.45);display:flex;align-items:flex-start;justify-content:center;z-index:300;padding:48px 16px;overflow:auto")}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={s("width:100%;max-width:620px;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--sh3);animation:tvin .16s ease-out")}
          >
            <div style={s("display:flex;align-items:flex-start;gap:14px;padding:20px 22px 16px;border-bottom:1px solid var(--border)")}>
              <div style={s("flex:1;min-width:0")}>
                <div style={s("font-size:20px;font-weight:800;letter-spacing:-.4px")}>
                  {content.title}
                </div>
                <div style={s("font-size:14px;color:var(--t2);margin-top:6px;line-height:1.55")}>
                  {content.intro}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={s("display:flex;border:1px solid var(--border);background:var(--surface);border-radius:8px;padding:5px;cursor:pointer;color:var(--t3);flex:none;font-family:inherit")}
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>

            <div style={s("padding:6px 22px 20px")}>
              {content.sections.map((sec, i) => (
                <div
                  key={sec.heading}
                  style={sx("padding:14px 0", {
                    borderBottom: i < content.sections.length - 1 ? "1px solid var(--border)" : "none",
                  })}
                >
                  <div style={s("display:flex;align-items:baseline;gap:10px")}>
                    <span style={s("width:20px;height:20px;border-radius:50%;background:var(--brand-tint);color:var(--brand-ink);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none")}>
                      {i + 1}
                    </span>
                    <div style={s("font-size:14px;font-weight:700")}>{sec.heading}</div>
                  </div>
                  <div style={s("font-size:13.5px;color:var(--t2);line-height:1.6;margin-top:7px;padding-left:30px")}>
                    {sec.body}
                  </div>
                </div>
              ))}
            </div>

            <div style={s("padding:13px 22px;border-top:1px solid var(--border);background:var(--surface-2);border-radius:0 0 16px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap")}>
              <div style={s("font-size:12px;color:var(--t4)")}>
                Reopen this any time from the <strong style={s("font-weight:700")}>?</strong> button.
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={s("padding:0 14px;height:34px;border:0;border-radius:9px;font-size:13px;font-weight:700;background:var(--brand);color:#fff;cursor:pointer;font-family:inherit")}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
