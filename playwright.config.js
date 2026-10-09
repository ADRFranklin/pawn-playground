import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './web/editor-tests/browser',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:7073',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ['--no-sandbox']
    }
  },
  webServer: {
    command: 'go run ./cmd/server --addr 127.0.0.1:7073 --db /tmp/ppg-browser-test.db',
    url: 'http://127.0.0.1:7073',
    reuseExistingServer: false,
    timeout: 120000
  }
});
