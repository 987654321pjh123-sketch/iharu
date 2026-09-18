import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/e2e', fullyParallel:true, retries:0,
  use:{ baseURL:'http://127.0.0.1:4173', browserName:'chromium', headless:true,
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {
      executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,
      args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],
    } : {},
  },
  webServer:{ command:'npm run start', url:'http://127.0.0.1:4173/api/health', reuseExistingServer:!process.env.CI,
    env:{ APP_ENV:'local', DEMO_MODE:'true' } },
});
