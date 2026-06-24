# pyr3-native flames — adding to the Flame Gallery 🎨

This folder holds the **ledger** for the pyr3-native flames shown in the Flame
Gallery (`/gallery`) under the reserved gen **`pyr3`** (#435). The flames lead
page 1 (newest-first), filterable by variation like any sheep.

This is a **recurring, repeatable** process — run it whenever you've made flames
worth adding.

## ➕ The loop — add new flames

```bash
# 1. In pyr3, make a flame you like → Save Render.
#    The PNG embeds the full genome in a `pyr3` tEXt chunk automatically.
#    Keep all your keepers in one folder (default: ~/pyr3-flames).

# 2. Re-bake. Scans the WHOLE folder; only genuinely-new flames are added.
npm run bake:natives                 # or: npm run bake:natives -- --src <dir>

# 3. Commit the regenerated data + push. Deploy publishes it to pyr3.app.
git add public/chunks/1000 public/chunks/pyr3-*.* flames/pyr3-natives/ledger.json
git commit -m "flames: add N pyr3 natives"
git push
```

That's it. No code changes — adding flames is pure data + commit.

## 🧠 What the bake guarantees

- **The folder is the full collection.** The bake scans every PNG in `--src`
  and re-emits the complete gen. Remove a PNG from the folder → it leaves the
  gallery on the next bake.
- **Dedup.** Flames are keyed by a content hash of the flame *definition*
  (ignores name / nick / output size / quality), so the same flame re-saved at
  a different resolution, or renamed, collapses to one entry. Re-running on an
  unchanged folder is a no-op.
- **Stable ids.** `ledger.json` maps content-hash → id; ids only ever grow and
  are never reassigned, so shared `/browse/gen/pyr3/id/M` URLs never break across
  re-bakes.
- **`nick:'pyr3'`** is forced on every flame (the "· by pyr3" badge).

## 📦 What gets emitted (all committed)

| Path | What |
| --- | --- |
| `public/chunks/1000/00000.flam3chunk` | id → pyr3-JSON genome (brotli) |
| `public/chunks/1000/avail.flam3idx` | sorted id list (brotli LEB128) |
| `public/chunks/pyr3-gens.json` | gen manifest entry (merged client-side) |
| `public/chunks/pyr3-features.flam3idx` | feature records — powers variation filtering |
| `flames/pyr3-natives/ledger.json` | the hash → id ledger (source of stable ids) |

> On-wire the gen is the integer **1000** (chunk paths, feature records); every
> user-facing surface displays it as **`pyr3`** (URLs, labels, nav pills) via
> `src/native-gen.ts`. The gen is reserved above every ESF gen so pyr3
> originals lead the newest-first gallery.

## 🔧 Implementation pointers

- CLI: `bin/pyr3-bake-natives.ts` (+ helpers in `bin/native-bake/`).
- Client merge of the sidecars: `src/corpus-bounds.ts` (gens) and
  `src/feature-index-client.ts` (features) — the ESF Release tar clobbers
  `gens.json`/`features.flam3idx` on deploy, so pyr3 data is merged at runtime
  from these distinct committed sidecars.
- Display mapping: `src/native-gen.ts` (`formatGenLabel` / `parseGenSegment`).
