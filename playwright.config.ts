import { defineConfig } from "@playwright/test";

// Smoke tests sem login (rodam sem credenciais de teste): páginas públicas,
// cabeçalhos de segurança e proteção de rotas. Fluxos autenticados
// (agenda, financeiro, prontuário) são validados manualmente contra um
// projeto Supabase de teste — ver README.
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
