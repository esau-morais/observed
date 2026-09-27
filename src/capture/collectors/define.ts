import { Schema, type Effect, type FileSystem } from 'effect';
import type {
  CollectorConfig,
  EvidenceKind,
  EvidenceValue,
} from '../../evidence-kinds';
import type { processOutput } from '../process';
import type { Recipe, Step } from '../recipe';

type Command = ReturnType<typeof processOutput>;

export type CollectorError =
  | EvidenceUnavailable
  | BrowserFailure
  | Schema.SchemaError
  | Effect.Error<Command>;

export type CollectorServices =
  Effect.Services<Command> | FileSystem.FileSystem;

// Records the evidence entry as unavailable; the capture still completes and
// checks that read this kind become unknown.
export class EvidenceUnavailable extends Schema.TaggedError<EvidenceUnavailable>()(
  'EvidenceUnavailable',
  { reason: Schema.String },
) {}

// Fails the whole capture.
export class BrowserFailure extends Schema.TaggedError<BrowserFailure>()(
  'BrowserFailure',
  { message: Schema.String },
) {}

export type CollectorContext = {
  readonly directory: string;
  readonly url: string;
  readonly recipe: Recipe;
  readonly concealed: readonly string[];
  readonly browser: (
    args: readonly string[],
    stdin?: string,
  ) => Effect.Effect<string, CollectorError, CollectorServices>;
  // Runs agent-browser, saves its redacted output as an artifact, and returns
  // the unredacted output.
  readonly saveOutput: (
    id: string,
    filename: string,
    args: readonly string[],
  ) => Effect.Effect<string, CollectorError, CollectorServices>;
  readonly addArtifact: (
    id: string,
    filename: string,
    description: string,
  ) => void;
};

export type SeparateSessionContext = CollectorContext & {
  readonly runSteps: (
    steps: readonly Step[],
  ) => Effect.Effect<void, CollectorError, CollectorServices>;
};

type Collect<K extends EvidenceKind, C> = (
  config: CollectorConfig<K>,
  context: C,
) => Effect.Effect<EvidenceValue<K>, CollectorError, CollectorServices>;

export type Collector<K extends EvidenceKind> =
  // Runs in the journey's browser session after `steps` and the snapshot,
  // before the screenshot, while requests are still recorded. It must not
  // navigate or send requests: anything it causes counts in the journey.
  | {
      readonly phase: 'journey';
      readonly collect: Collect<K, CollectorContext>;
    }
  // Runs after the journey's screenshot and request recording, with the app
  // still running, in a fresh agent-browser session of its own. That session
  // launches on the collector's first browser() call, so the collector can
  // pass launch flags such as --init-script there. Observed closes it.
  | {
      readonly phase: 'separate-session';
      readonly launchArguments?: readonly string[];
      readonly collect: Collect<K, SeparateSessionContext>;
    };
