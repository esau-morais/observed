// The corpus renames saved.spec.ts.txt to saved.spec.ts before it commits the
// fixture, so Vitest never discovers this suite. The runner sets BASE_URL and
// PLAYWRIGHT_JSON_OUTPUT_FILE, and the test command enables the JSON reporter
// without overriding its output file.
export default {
  testDir: '.',
  testMatch: 'saved.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 10000,
  expect: { timeout: 1000 },
  use: {
    baseURL: process.env.BASE_URL,
    browserName: 'chromium',
    launchOptions: { args: ['--no-sandbox'] },
  },
};
