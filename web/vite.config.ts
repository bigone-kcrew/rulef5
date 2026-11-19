import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// 빌드 결과는 서버가 그대로 서빙하는 ../app/public 에 쓴다(서버는 외부 패키지 없이 실행)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
  build: { outDir: resolve(import.meta.dirname, "../app/public"), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { proxy: { "/api": "http://127.0.0.1:18107" } },
})
