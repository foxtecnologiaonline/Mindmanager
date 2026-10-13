import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tudo aqui é função pura (sem estado mutável entre módulos) e só um
    // arquivo usa vi.mock — reusar os workers entre arquivos é seguro e
    // mais rápido que isolar um processo por arquivo.
    isolate: false,
  },
});
