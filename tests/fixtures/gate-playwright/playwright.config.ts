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
