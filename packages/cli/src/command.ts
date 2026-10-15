import { receipt } from '@observed/judge';
import { EvidenceStoreError, evidenceRef, readRecords } from '@observed/runner';
import { Console, Effect } from 'effect';
import { Argument, Command } from 'effect/cli';

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
  Command.withSubcommands([printReceipt]),
);
