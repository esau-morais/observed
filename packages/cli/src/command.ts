import { Command } from 'effect/cli';

export const observed = Command.make('observed').pipe(
  Command.withDescription("See what your agent's change actually did."),
);
