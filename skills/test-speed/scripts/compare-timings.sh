#!/usr/bin/env bash
# Usage: compare-timings.sh <before.tsv> <after.tsv>
#
# Compares two `time-tests.sh --out` files: per test file the seconds before and after (slowest
# before first), then the sum and the wall time. A file only in one run shows "-" on the other side.
# Prints a Markdown table, ready for the PR description.
set -euo pipefail

die() {
  echo "compare-timings: $*" >&2
  exit 2
}

[[ $# -eq 2 ]] || die "usage: compare-timings.sh <before.tsv> <after.tsv>"
for f in "$1" "$2"; do [[ -f ${f} ]] || die "no such file: ${f}"; done

awk -F'\t' '
  function fmt(v) { return v == "" ? "-" : sprintf("%.1f s", v) }
  function change(b, a) {
    if (b == "" || a == "" || b == 0) return "-"
    return sprintf("%+.0f%%", 100 * (a - b) / b)
  }
  FNR == 1 { run++ }
  $1 == "# wall" { wall[run] = $2; next }
  /^#/ || NF < 3 { next }
  {
    if (!($3 in seen)) { seen[$3] = 1; order[++n] = $3 }
    t[run, $3] = $1
    if ($2 != "ok") state[run, $3] = " (" $2 ")"
    sum[run] += $1
  }
  END {
    # Slowest before first; files only in the after run at the end.
    for (i = 1; i <= n; i++) key[i] = ((1, order[i]) in t) ? t[1, order[i]] : -1
    for (i = 2; i <= n; i++) for (j = i; j > 1 && key[j] > key[j - 1]; j--) {
      k = key[j]; key[j] = key[j - 1]; key[j - 1] = k
      o = order[j]; order[j] = order[j - 1]; order[j - 1] = o
    }
    print "| Test file | Before | After | Change |"
    print "|---|---|---|---|"
    for (i = 1; i <= n; i++) {
      f = order[i]
      b = ((1, f) in t) ? t[1, f] : ""
      a = ((2, f) in t) ? t[2, f] : ""
      printf "| `%s` | %s%s | %s%s | %s |\n", f, fmt(b), state[1, f], fmt(a), state[2, f], change(b, a)
    }
    printf "| **Sum of files** | %s | %s | %s |\n", fmt(sum[1]), fmt(sum[2]), change(sum[1], sum[2])
    if (wall[1] != "" || wall[2] != "")
      printf "| **Wall time** | %s | %s | %s |\n", fmt(wall[1]), fmt(wall[2]), change(wall[1], wall[2])
  }' "$1" "$2"
