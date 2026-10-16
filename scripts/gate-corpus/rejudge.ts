import { conclusionExitCodes, inspectComparison, json, selectionSchema } from '@observed/judge';
import { Effect, Schema } from 'effect';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Judges the captures in a run directory again from its selection.json, the
// way `observed run` does after capturing, and exits with the conclusion's
// exit code. The missing-evidence probes call it on edited copies.

const [directory] = process.argv.slice(2);

if (directory === undefined) {
  throw new Error('Usage: bun scripts/gate-corpus/rejudge.ts RUN_DIRECTORY');
}

const selection = Schema.decodeUnknownSync(Schema.fromJsonString(selectionSchema))(
  await readFile(path.join(directory, 'selection.json'), 'utf8'),
);
const { result } = await Effect.runPromise(inspectComparison({ root: directory, selection }));

await writeFile(path.join(directory, 'result.json'), json(result));
process.exitCode = conclusionExitCodes[result.conclusion.kind];
