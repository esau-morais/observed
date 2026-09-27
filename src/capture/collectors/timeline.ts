import { Effect, FileSystem, Schema } from 'effect';
import path from 'node:path';
import { timelineValue } from '../step-log';
import type { Collector } from './define';

const snapshotSchema = Schema.fromJsonString(
  Schema.Struct({ data: Schema.Struct({ snapshot: Schema.String }) }),
);

export const timeline: Collector<'timeline'> = {
  phase: 'journey',
  onFailure: true,
  collect: (_config, context) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const filename = path.join(context.directory, 'snapshot.json');
      const tree = (yield* fs.exists(filename))
        ? (yield* Schema.decodeUnknownEffect(snapshotSchema)(
            yield* fs.readFileString(filename),
          )).data.snapshot
        : null;

      return timelineValue(context.recipe.steps, context.steps, tree);
    }),
};
