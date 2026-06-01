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
# USAGE: bake-features-batched.sh <esf-root> <corpus-tag> <out-path> [batch-size] [--force]
#
# By default the script ALWAYS resumes from `<out-path>.part` if it exists,
# so a re-run after a crash picks up where it left off — and a re-run after
# a parser fix retries the previously-failed sheep (failures aren't written
# to .part, so they're naturally re-attempted on the next pass).
#
# --force: wipe `.part` + `.errors.log` first, then bake fresh from sheep 0.
# Use when the binary format changed, the corpus tag changed, or you want a
# guaranteed clean output regardless of prior state.
#
# Subprocess stderr is captured to `<out-path>.errors.log` (append-only across
# runs, so morning-after you can grep the prior night's failures). Stdout is
# the per-batch [batched-bake] progress lines that print to your terminal.
#
# Example:
#   ./scripts/bake-features-batched.sh \
#     /Users/matt/dev/MattAltermatt/electric-sheep-fold \
#     corpus-chunks-genome-2026-06-01 \
#     /tmp/features.flam3idx

# `set -u` (undefined vars) + pipefail are safety nets we keep; we
# DELIBERATELY drop `set -e` so a single-batch crash (e.g. the dawn-node
# SIGSEGV that surfaces ~1× per 4-5k sheep at this scale) doesn't kill
# the whole hours-long bake. The loop below detects no-progress runs
# and bails after MAX_NOPROGRESS in a row instead.
set -uo pipefail

FORCE=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *)       POSITIONAL+=("$arg") ;;
  esac
done

if [[ ${#POSITIONAL[@]} -lt 3 || ${#POSITIONAL[@]} -gt 4 ]]; then
  echo "usage: $0 <esf-root> <corpus-tag> <out-path> [batch-size] [--force]" >&2
  exit 1
fi

ESF_ROOT="${POSITIONAL[0]}"
TAG="${POSITIONAL[1]}"
OUT="${POSITIONAL[2]}"
BATCH="${POSITIONAL[3]:-30}"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

PART="${OUT}.part"
ERR_LOG="${OUT}.errors.log"

if [[ ${FORCE} -eq 1 ]]; then
  echo "[batched-bake] --force: wiping ${PART} + ${ERR_LOG}"
  rm -f "${PART}" "${ERR_LOG}"
fi

# Stamp a session header into the error log so post-run greps can tell
# which run a given failure belongs to.
mkdir -p "$(dirname "${ERR_LOG}")"
{
  echo "════════════════════════════════════════════════════════════════════════════"
  echo "[batched-bake] session $(date '+%Y-%m-%d %H:%M:%S') · tag=${TAG}"
  echo "════════════════════════════════════════════════════════════════════════════"
} >> "${ERR_LOG}"

echo "[batched-bake] esf=${ESF_ROOT} tag=${TAG} out=${OUT} batch=${BATCH}"
echo "[batched-bake] error log: ${ERR_LOG}"

# Discover total genome-only corpus size — what the bake CLI's allowlist
# filter will actually process (kind=="genome" in ESF's index.json). The
# raw filesystem count of *.flam3 files is ~3x larger (animation files
# are included on disk but skipped by the bake) — using THAT here makes
# progress percentages wrong AND breaks the `DONE >= TOTAL` completion
# check (DONE would cap at ~52k while TOTAL stays at ~166k → infinite loop).
INDEX="${ESF_ROOT}/corpus/_index/index.json"
if [[ ! -f "${INDEX}" ]]; then
  echo "[batched-bake] ESF index missing: ${INDEX}" >&2
  exit 1
fi
# Same filter the bake CLI's loadGenomeAllowlist applies — genome-kind AND
# xform_count>0 (ESF v7 has 109 "genome" entries with zero xforms that
# parseFlame can't render; they're excluded from the bake set so progress
# math matches the renderable count exactly).
TOTAL=$(jq '[.genomes[] | select(.kind == "genome" and .xform_count > 0)] | length' "${INDEX}")
echo "[batched-bake] genome-only renderable total: ${TOTAL} sheep"

# Resume policy: if `.part` already has records, pass --resume on EVERY
# invocation so the bake CLI picks up where it left off. Only when no
# .part exists at all do we omit --resume.
#
# Crash resilience: a single npm subprocess may exit with SIGSEGV (139)
# under dawn-node native-pool pressure ~1× per several thousand sheep.
# We tolerate the failure as long as the .part record count keeps
# advancing — only bail out if MAX_NOPROGRESS batches in a row produce
# zero new records (the bake is genuinely stuck or the file is broken).
MAX_NOPROGRESS=5
NOPROGRESS=0
START=$(date +%s)
PREV_DONE=-1
while :; do
  if [[ -f "${PART}" ]]; then
    DONE=$(( $(stat -f%z "${PART}" 2>/dev/null || stat -c%s "${PART}") / 30 ))
    RESUME_FLAG="--resume"
  else
    DONE=0
    RESUME_FLAG=""
  fi
  if [[ ${DONE} -ge ${TOTAL} ]]; then
    echo "[batched-bake] ${DONE}/${TOTAL} complete — running final finalize pass"
    npm run bake-features -- \
      --esf-root "${ESF_ROOT}" --tag "${TAG}" --out "${OUT}" --resume
    break
  fi
  # `|| true` keeps the loop alive past a SIGSEGV in the bake CLI; the
  # no-progress counter below catches a genuinely stuck pipeline.
  # stderr → ERR_LOG so per-sheep parse warnings + the rare subprocess
  # crash signature are inspectable after the run. stdout (per-batch
  # progress lines) is suppressed since the parent loop's printf does
  # its own progress reporting.
  npm run bake-features -- \
    --esf-root "${ESF_ROOT}" --tag "${TAG}" --out "${OUT}" \
    ${RESUME_FLAG} --limit "${BATCH}" >/dev/null 2>>"${ERR_LOG}" || true
  # Detect no-progress (subprocess crashed before writing anything new).
  if [[ ${DONE} -le ${PREV_DONE} ]]; then
    NOPROGRESS=$(( NOPROGRESS + 1 ))
    if [[ ${NOPROGRESS} -ge ${MAX_NOPROGRESS} ]]; then
      echo "[batched-bake] ABORT — ${MAX_NOPROGRESS} batches in a row produced zero new records (DONE=${DONE}). Investigate the .part state + the bake CLI manually." >&2
      exit 1
    fi
  else
    NOPROGRESS=0
  fi
  PREV_DONE=${DONE}
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
