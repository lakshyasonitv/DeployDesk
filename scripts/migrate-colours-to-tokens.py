import pathlib, re, sys, collections

MAP = {
  "#101014":"var(--t1)", "#26262e":"var(--t1)", "#1b1b21":"var(--t1)",
  "#4a4a58":"var(--t2)", "#a0a0ac":"var(--t2)",
  "#6b6b78":"var(--t3)", "#8b8b96":"var(--t3)",
  "#8a8a96":"var(--t4)", "#6c6c78":"var(--t4)", "#9a9aa6":"var(--t4)",
  "#9aa0ab":"var(--t4)", "#b0b0bc":"var(--t4)", "#5c5c68":"var(--t4)",
  "#3f3f4a":"var(--t4)",
  "#ffffff":"var(--surface)", "#fff":"var(--surface)",
  "#fafafc":"var(--surface-2)", "#f7f7fa":"var(--surface-2)", "#f6f6fa":"var(--surface-2)",
  "#f7f7f9":"var(--bg)",
  "#f1f1f5":"var(--surface-3)", "#f3f3f7":"var(--surface-3)", "#f4f4f8":"var(--surface-3)",
  "#f2f2f5":"var(--surface-3)", "#f1f1f4":"var(--surface-3)",
  "#e8e8ee":"var(--border)", "#eeeef3":"var(--border)", "#eaeaef":"var(--border)",
  "#26262c":"var(--border)", "#33333b":"var(--border)", "#3b3b45":"var(--border)",
  "#e0e0e8":"var(--border-2)", "#d4d4de":"var(--border-2)", "#c9c9d2":"var(--border-2)",
  "#dcdce4":"var(--border-2)", "#d8d8e2":"var(--border-2)",
  "#6d3ff0":"var(--brand)", "#5a2fd0":"var(--brand-h)",
  "#f1ecff":"var(--brand-tint)", "#f5f2ff":"var(--brand-tint)", "#1e1e26":"var(--brand-tint)",
  "#e4dcff":"var(--brand-tint-2)", "#c9bef0":"var(--brand-tint-2)", "#c9b6ff":"var(--brand-tint-2)",
  "#a78bfa":"var(--brand)", "#8b5cf6":"var(--brand)", "#6366f1":"var(--brand)",
  "#34d399":"var(--brand)", "#fbbf24":"var(--brand)", "#f97316":"var(--brand)",
  "#111114":"var(--surface)",
  "#0f7a4a":"var(--ok)", "#16a34a":"var(--ok)", "#059669":"var(--ok)",
  "#e8f6ef":"var(--ok-tint)", "#f6fdfa":"var(--ok-tint)", "#e9f7ee":"var(--ok-tint)",
  "#cfe9dd":"var(--ok-tint)", "#b9ccc2":"var(--ok-tint)",
  "#b45309":"var(--warn)", "#c2410c":"var(--warn)", "#8a5a08":"var(--warn)",
  "#d9a066":"var(--warn)", "#f59e0b":"var(--warn)",
  "#fff3e4":"var(--warn-tint)", "#fff8ef":"var(--warn-tint)", "#f0dcc0":"var(--warn-tint)",
  "#fffaf2":"var(--warn-tint)", "#f5e3c8":"var(--warn-tint)", "#fff8ec":"var(--warn-tint)",
  "#fdf0e7":"var(--warn-tint)", "#f7e2bd":"var(--warn-tint)", "#f7dcae":"var(--warn-tint)",
  "#b91c1c":"var(--danger)", "#ef4444":"var(--danger)",
  "#fdecec":"var(--danger-tint)", "#f6cfcf":"var(--danger-tint)", "#f0c9c9":"var(--danger-tint)",
  "#fffbfb":"var(--danger-tint)", "#e0b3b3":"var(--danger-tint)",
  "#1d4ed8":"var(--info)", "#e8eefc":"var(--info-tint)",
  "#0d9488":"var(--teal)", "#0f766e":"var(--teal)",
  "#f0fdfa":"var(--teal-tint)", "#e6fffa":"var(--teal-tint)",
}

keys = sorted(MAP, key=len, reverse=True)
pattern = re.compile("(?:" + "|".join(re.escape(k) for k in keys) + r")(?![0-9a-fA-F])", re.I)

targets = []
for base in ["app", "src/lib/ui", "src/read-models"]:
    for ext in ("*.ts", "*.tsx"):
        targets += list(pathlib.Path(base).rglob(ext))

changed, total = 0, collections.Counter()
for f in targets:
    if f.name in ("style.ts", "Shell.tsx", "ThemeToggle.tsx"):
        continue
    t = f.read_text(encoding="utf-8")
    def sub(m):
        v = m.group(0).lower()
        total[v] += 1
        return MAP[v]
    out = pattern.sub(sub, t)
    if out != t:
        f.write_text(out, encoding="utf-8")
        changed += 1

sys.stdout.write("files changed: %d\nreplacements: %d\n" % (changed, sum(total.values())))
