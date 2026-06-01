#!/usr/bin/env bash
# bake-features-batched.sh — Workaround wrapper around `npm run bake-features`.
#
# WHY: the in-process bake CLI SIGSEGVs (exit 139) reliably at iteration 36-37
# inside dawn-node's GPU loop, with flat JS memory + GC every iter + reused
# textures/buffers — i.e. NOT a JS-side leak. The crash floor is sharp,
# suggesting a fixed-size native resource pool in dawn-node we can't reach
# from JS. Diagnostic isolation (reusing one parsed genome across all iters)
# confirmed it's the GPU render+readback cycle, not parseFlame/happy-dom.
#
# WORKAROUND: invoke the bake with `--limit 30 --resume` in a loop. Each
# subprocess fresh-inits dawn-node, processes 30 sheep (well under the 36
# crash floor), exits cleanly, and the next iteration picks up where it
# left off via the `.part` sidecar's resume mechanism.
#
# COST: ~1.8s subprocess startup + ~1.6s of render work per batch. For the
# full 166614-sheep ESF corpus → 5554 batches × 3.4s ≈ 5.2 hours wall.
# Acceptable for a once-per-corpus-release bake.
#
# USAGE: bake-features-batched.sh <esf-root> <corpus-tag> <out-path> [batch-size]
#
# Example:
#   ./scripts/bake-features-batched.sh \
#     /Users/matt/dev/MattAltermatt/electric-sheep-fold \
#     corpus-chunks-genome-2026-05-29 \
#     /tmp/features.flam3idx

set -euo pipefail

if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo "usage: $0 <esf-root> <corpus-tag> <out-path> [batch-size]" >&2
  exit 1
fi

ESF_ROOT="$1"
TAG="$2"
OUT="$3"
BATCH="${4:-30}"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

PART="${OUT}.part"
echo "[batched-bake] esf=${ESF_ROOT} tag=${TAG} out=${OUT} batch=${BATCH}"

# Discover total corpus size so we can compute progress. Cheap — just walk
# the directory tree once.
TOTAL=$(find "${ESF_ROOT}/corpus" -name 'electricsheep.*.flam3' | wc -l | tr -d ' ')
echo "[batched-bake] corpus total: ${TOTAL} sheep"

# First invocation: NO --resume so any stale .part is truncated. Subsequent
# invocations use --resume.
FIRST=1
START=$(date +%s)
while :; do
  if [[ -f "${PART}" ]]; then
    DONE=$(( $(stat -f%z "${PART}" 2>/dev/null || stat -c%s "${PART}") / 30 ))
  else
    DONE=0
  fi
  if [[ ${DONE} -ge ${TOTAL} ]]; then
    echo "[batched-bake] ${DONE}/${TOTAL} complete — running final finalize pass"
    npm run bake-features -- \
      --esf-root "${ESF_ROOT}" --tag "${TAG}" --out "${OUT}" --resume
    break
  fi
  if [[ ${FIRST} -eq 1 ]]; then
    FIRST=0
    npm run bake-features -- \
      --esf-root "${ESF_ROOT}" --tag "${TAG}" --out "${OUT}" \
      --limit "${BATCH}" >/dev/null
  else
    npm run bake-features -- \
      --esf-root "${ESF_ROOT}" --tag "${TAG}" --out "${OUT}" \
      --resume --limit "${BATCH}" >/dev/null
  fi
  NEW_DONE=$(( $(stat -f%z "${PART}" 2>/dev/null || stat -c%s "${PART}") / 30 ))
  ELAPSED=$(( $(date +%s) - START ))
  if [[ ${NEW_DONE} -gt 0 && ${ELAPSED} -gt 0 ]]; then
    RATE_NUM=$(( NEW_DONE * 100 / ELAPSED ))   # sheep × 100 / sec
    REMAIN=$(( TOTAL - NEW_DONE ))
    ETA_SEC=$(( REMAIN * 100 / (RATE_NUM > 0 ? RATE_NUM : 1) ))
    ETA_MIN=$(( ETA_SEC / 60 ))
    printf "[batched-bake] %d/%d (%d%%) — %d.%02d sheep/s — ETA %d min\n" \
      "${NEW_DONE}" "${TOTAL}" $(( NEW_DONE * 100 / TOTAL )) \
      $(( RATE_NUM / 100 )) $(( RATE_NUM % 100 )) "${ETA_MIN}"
  fi
done

echo "[batched-bake] done — wrote ${OUT}"
