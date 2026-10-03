import { Schema } from 'effect';
import { text } from '../capture/model';
import { defineEvidence } from './define';

const line = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const lineRangeSchema = Schema.Tuple([line, line]).check(
  Schema.makeFilter(([start, end]) => start <= end, {
    message: 'A line range starts at or before its end',
  }),
);

export type LineRange = typeof lineRangeSchema.Type;

// Ranges must be sorted and must not overlap, within and across the two
// lists, so a line is either executed, unexecuted, or absent.
function disjoint(lists: readonly (readonly LineRange[])[]): boolean {
  const all = lists.flat().toSorted((left, right) => left[0] - right[0]);

  return all.every(
    (range, index) => index === 0 || (all[index - 1]?.[1] ?? 0) < range[0],
  );
}

const sorted = (ranges: readonly LineRange[]) =>
  ranges.every(
    (range, index) => index === 0 || (ranges[index - 1]?.[0] ?? 0) < range[0],
  );

export const coverageValueSchema = Schema.Struct({
  // Paths relative to the captured project, as in its source snapshot.
  files: Schema.Array(
    Schema.Struct({
      path: text,
      executed: Schema.Array(lineRangeSchema),
      unexecuted: Schema.Array(lineRangeSchema),
    }).check(
      Schema.makeFilter(
        (file) =>
          sorted(file.executed) &&
          sorted(file.unexecuted) &&
          disjoint([file.executed, file.unexecuted]),
        {
          message:
            'Coverage line ranges must be sorted, and no line can be both executed and unexecuted',
        },
      ),
    ),
  ),
  // Each script with an http(s) address that the page ran, and why a script
  // or a file it names contributed no lines.
  scripts: Schema.Array(
    Schema.Union([
      Schema.Struct({
        script: text,
        kind: Schema.Literal('mapped'),
        files: Schema.Array(text),
        // Files the map names whose lines could not be used, with the reason.
        excluded: Schema.Array(Schema.Struct({ path: text, reason: text })),
      }),
      Schema.Struct({
        script: text,
        kind: Schema.Literal('unavailable'),
        reason: text,
      }),
    ]),
  ),
}).check(
  Schema.makeFilter(
    (value) =>
      new Set(value.files.map((file) => file.path)).size === value.files.length,
    { message: 'Coverage lists each file once' },
  ),
);

export type CoverageEvidence = typeof coverageValueSchema.Type;

export const coverage = defineEvidence({
  kind: 'coverage',
  title: 'Coverage',
  schemaVersion: 1,
  collector: { enabled: Schema.optionalKey(Schema.Boolean) },
  value: coverageValueSchema,
});
