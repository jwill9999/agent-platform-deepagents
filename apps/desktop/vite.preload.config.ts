import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: "src/preload.ts",
      formats: ["cjs"],
      fileName: () => "preload.cjs",
    },
    rolldownOptions: { external: ["electron"] },
  },
});
