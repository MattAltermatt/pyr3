// One-shot script to generate examples/spiral-galaxy.pyr3.json. Run via:
//   npx tsx scripts/gen-example.ts > examples/spiral-galaxy.pyr3.json
// Idempotent — produces deterministic output from SPIRAL_GALAXY.

import { genomeToJson } from '../src/serialize';
import { SPIRAL_GALAXY } from '../src/genome';

process.stdout.write(JSON.stringify(genomeToJson(SPIRAL_GALAXY), null, 2));
process.stdout.write('\n');
