import path from "path"
import http from "http"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
    proxy: {
      // 前端一律用相对路径 /api，dev 时转发到 LifeOS server
      '/api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
        // Node≥19 全局 Agent 默认 keep-alive，后端重启后代理会复用死连接，
        // 导致请求挂在池里几分钟才超时（表现为对话发出去没反应）。禁用复用。
        agent: new http.Agent({ keepAlive: false }),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
