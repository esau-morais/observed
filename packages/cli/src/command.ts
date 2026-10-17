import { receipt } from '@observed/judge';
import {
  EvidenceStoreError,
  evidenceRef,
  readRecords,
  runComparison,
  writeRecord,
} from '@observed/runner';
import { Console, DateTime, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import path from 'node:path';

const run = Command.make(
  'run',
  {
    project: Argument.Directory('project').pipe(
      Argument.withDescription('The directory that holds observed.json'),
      Argument.withDefault('.'),
    ),
    base: Flag.String('base').pipe(
      Flag.withDescription('The revision before the change'),
      Flag.withDefault('HEAD'),
    ),
    candidate: Flag.String('candidate').pipe(
      Flag.withDescription('The revision after the change; the working tree when omitted'),
      Flag.optional,
    ),
    output: Flag.String('output').pipe(
      Flag.withDescription('A new directory for the captures and result.json'),
      Flag.optional,
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const stamp = DateTime.formatIso(yield* DateTime.now).replaceAll(':', '-');
      const output = Option.getOrElse(options.output, () =>
        path.join(options.project, '.observed', 'runs', stamp),
      );
      const candidate = Option.getOrNull(options.candidate);
      const outcome = yield* runComparison({
        projectRoot: options.project,
        base: options.base,
        candidate,
        output,
      }).pipe(
        Effect.catchTags({
          ProjectFailure: ({ message }) => Effect.succeed({ unusable: message }),
          ProjectUnreadable: ({ message }) => Effect.succeed({ unusable: message }),
        }),
      );

      if ('unusable' in outcome) {
        yield* Console.error(outcome.unusable);
        process.exitCode = 1;
        return;
      }

      yield* Console.log(outcome.result.conclusion.text);
      yield* Console.log(`Result: ${outcome.layout.result}`);
      process.exitCode = outcome.exitCode;

      if (candidate === null) {
        yield* Console.log('No record: the working tree is not a commit.');
        return;
      }

      const written = yield* writeRecord({
        cwd: options.project,
        commit: candidate,
        captures: outcome.layout.root,
        selection: outcome.selection,
        result: outcome.result,
      }).pipe(
        Effect.catchTag('EvidenceStoreError', (error) =>
          Console.error(`The record was not stored: ${error.message}`).pipe(Effect.as(null)),
        ),
      );

      if (written !== null) {
        yield* Console.log(`Record: ${evidenceRef} ${written.commit}/${written.id}`);
      }
    }),
).pipe(Command.withDescription('Run every journey on both revisions and judge the change.'));

const printReceipt = Command.make(
  'receipt',
  {
    revision: Argument.String('revision').pipe(
      Argument.withDescription('The commit to print the receipt for.'),
      Argument.withDefault('HEAD'),
    ),
  },
  ({ revision }) =>
    Effect.gen(function* () {
      const latest = (yield* readRecords({ cwd: process.cwd(), commit: revision })).at(-1);

      if (latest === undefined) {
        return yield* new EvidenceStoreError({
          message: `${revision} has no record in ${evidenceRef}.`,
        });
      }

      yield* Console.log(receipt(latest.result));
    }).pipe(
      Effect.catchTag('EvidenceStoreError', (error) =>
        Console.error(error.message).pipe(
          Effect.andThen(
            Effect.sync(() => {
              process.exitCode = 1;
            }),
          ),
        ),
      ),
    ),
).pipe(Command.withDescription(`Print the receipt for a commit from ${evidenceRef}.`));

export const observed = Command.make('observed').pipe(
  Command.withDescription("See what your agent's change actually did."),
  Command.withSubcommands([run, printReceipt]),
);
