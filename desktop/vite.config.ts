import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1422,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Keep file viewers and terminal runtimes out of the launch bundle.
        // They are already lazy-loaded by ResourceViewer, so stable vendor
        // chunks let the browser cache each capability independently.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/pdfjs-dist/") || id.includes("/react-pdf/")) {
            return "vendor-pdf";
          }
          if (id.includes("/xlsx/")) {
            return "vendor-spreadsheet";
          }
          if (id.includes("/docx-preview/")) {
            return "vendor-document";
          }
          if (id.includes("/@xterm/") || id.includes("/xterm/")) {
            return "vendor-terminal";
          }
          if (
            id.includes("/react-markdown/") ||
            id.includes("/remark-gfm/") ||
            id.includes("/streamdown/") ||
            id.includes("/highlight.js/")
          ) {
            return "vendor-markdown";
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts", "src/**/*.{test,spec}.tsx"],
  },
}));
