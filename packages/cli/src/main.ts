import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';
import { Command } from 'effect/cli';
import packageJson from '../package.json' with { type: 'json' };
import { observed } from './command';

observed.pipe(
  Command.run({ version: packageJson.version }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
