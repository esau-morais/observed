import { Schema } from 'effect';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkRun, expectationSchema } from './check';

export async function checkRequestFault(directory: string, exit: number) {
  const expectation = Schema.decodeUnknownSync(
    Schema.fromJsonString(expectationSchema),
  )(await readFile(path.join(directory, 'expected.json'), 'utf8'));
  const report = path.join(directory, 'run/report');
  const result = await checkRun(report, expectation, exit);
  const [firstRaw, ...otherRaw] = expectation.assertions.flatMap((assertion) =>
    assertion.raw === undefined
      ? []
      : [{ ...assertion, actual: assertion.raw }],
  );
  if (firstRaw === undefined) {
    throw new Error('Request fault needs independent raw readings');
  }

  const raw = await checkRun(
    report,
    {
      ...expectation,
      exitCode: 0,
      assertions: [firstRaw, ...otherRaw],
    },
    0,
  );

  return { result, raw };
}
