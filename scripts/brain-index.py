#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Regenerate the index at the top of project-brain/02-decisions.md from its own headings.

    python scripts/brain-index.py            # rewrite the index
    python scripts/brain-index.py --check    # exit 1 if it is out of date, change nothing

WHY THIS EXISTS
---------------

That file's header says two things: *"Newest entry at the TOP"* and *"Generated from the
headings - regenerate it rather than editing by hand"*. There was nothing to regenerate it
WITH, so both rules drifted twice in one week: entries were appended to the bottom across
three sessions, which left the newest decisions below 37 older ones and missing from the
index entirely. An instruction with no tool behind it is a comment.

This only touches the index block. Entry bodies are never rewritten, and the script asserts
that every heading it found still appears in the output before writing anything.
"""
import argparse
import pathlib
import re
import sys

FILE = pathlib.Path(__file__).resolve().parent.parent / "project-brain" / "02-decisions.md"

# "## 2026-10-08 - Title", with an em dash.
HEADING = re.compile(u"^## (20\\d\\d-\\d\\d-\\d\\d) — (.+)$", re.M)

PREAMBLE = (
    u"> Newest first, which is also the order of the entries below. Generated from the "
    u"headings — regenerate it rather than editing by hand."
)


def anchor(date, title):
    """GitHub's slug rule, matching the anchors already in the file."""
    slug = (u"%s — %s" % (date, title)).lower()
    slug = re.sub(r"[^a-z0-9 \-]", "", slug)
    slug = re.sub(r" +", "-", slug)
    return re.sub(r"-{2,}", "-", slug).strip("-")


def build(text):
    entries = HEADING.findall(text)
    if not entries:
        sys.exit("no dated entry headings in %s" % FILE.name)

    lines = [u"## Index", u"", PREAMBLE, u""]
    seen = None
    for date, title in entries:
        if date != seen:
            lines += [u"", u"**%s**" % date, u""]
            seen = date
        lines.append(u"- [%s](#%s)" % (title, anchor(date, title)))

    first = HEADING.search(text)
    head = text[:first.start()]
    if u"## Index" not in head:
        sys.exit("no existing index block to replace")
    rebuilt = head[:head.index(u"## Index")] + "\n".join(lines) + "\n\n" + text[first.start():]

    # Nothing may be lost: every heading must survive, and be named once in the index.
    #
    # Counted inside the INDEX BLOCK only. Entry bodies cross-link to each other by the same
    # anchors - "see the entry below" - so counting across the whole file reported a
    # duplicate for every entry anybody had linked to.
    index_block = rebuilt[:rebuilt.index(u"## %s — %s" % entries[0])]
    for date, title in entries:
        assert (u"## %s — %s" % (date, title)) in rebuilt, "lost heading %r" % title
        assert index_block.count(u"](#%s)" % anchor(date, title)) == 1, \
            "index entry for %r" % title

    # Dates must run newest-first, or the index is honest about a file that is not ordered.
    dates = [d for d, _ in entries]
    if dates != sorted(dates, reverse=True):
        sys.stderr.write(
            "WARNING: entries are not in newest-first order. The index now matches the file,\n"
            "         but the file no longer matches its own stated rule. Move the entries.\n")

    return rebuilt, len(entries)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="report whether the index is current; write nothing")
    args = ap.parse_args()

    text = FILE.read_text(encoding="utf-8")
    rebuilt, count = build(text)

    if rebuilt == text:
        print("%s: index is current (%d entries)" % (FILE.name, count))
        return 0
    if args.check:
        sys.stderr.write("%s: index is OUT OF DATE (%d entries). Run scripts/brain-index.py\n"
                         % (FILE.name, count))
        return 1

    FILE.write_text(rebuilt, encoding="utf-8")
    print("%s: index regenerated (%d entries)" % (FILE.name, count))
    return 0


if __name__ == "__main__":
    sys.exit(main())
