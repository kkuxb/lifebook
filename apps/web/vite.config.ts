import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "人生簿",
        short_name: "人生簿",
        description: "私密、轻快、高颜值的每日日记与人生回顾工具",
        theme_color: "#F6F7FA",
        background_color: "#F6F7FA",
        display: "standalone",
        lang: "zh-CN",
        icons: [
          {
            src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='48' fill='%23FFD43B'/%3E%3Cpath d='M54 138V54a18 18 0 0 1 18-18h66v108H72a18 18 0 0 0-18 18Z' fill='none' stroke='%23111827' stroke-width='12' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
            sizes: "192x192",
            type: "image/svg+xml"
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3220",
        changeOrigin: true
      }
    }
  }
});
