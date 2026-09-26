// Bun's runner would execute the Vitest suites with a 5 s timeout and without
// Vitest APIs, then leave their capture processes running.
console.error(
  'Observed tests run on Vitest. Use `bun run test` for unit tests and `bun run verify` for browser journeys.',
);
process.exit(1);
