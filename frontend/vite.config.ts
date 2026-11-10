import { defineConfig, type UserConfig } from 'vite'
class ViteConfiguration {
  static create(): UserConfig {
    return {
      server: {
        port: 5173,
        strictPort: true,
        proxy: {
          '/api': {
            target: process.env.MAINFLIX_BACKEND_URL ?? 'http://127.0.0.1:3000',
            changeOrigin: false,
          },
        },
      },
    }
  }
}
export default defineConfig(ViteConfiguration.create())
