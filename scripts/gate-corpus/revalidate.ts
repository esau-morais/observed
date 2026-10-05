import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  comparisonSchema,
  conclusionExitCodes,
} from '../../src/comparison-model';
import { preloadReport } from '../../src/view';

const [directory] = process.argv.slice(2);
if (directory === undefined) {
  throw new Error('Usage: bun scripts/gate-corpus/revalidate.ts COPIED_REPORT');
}

const assets = await Effect.runPromise(
  preloadReport(directory).pipe(Effect.provide(BunServices.layer)),
);
const asset = assets.get('/result.json');
if (asset === undefined) {
  throw new Error('Saved-report revalidation returned no result');
}

const result = Schema.decodeUnknownSync(
  Schema.fromJsonString(comparisonSchema),
)(new TextDecoder().decode(asset.bytes));
await writeFile(path.join(directory, 'result.json'), asset.bytes);
process.exitCode = conclusionExitCodes[result.conclusion.kind];
