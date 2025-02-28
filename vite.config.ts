import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode === 'production'
  
  return {
    base: isProd 
      ? '/Lynx_Player/' // 替换为您的仓库名
      : '/',
    plugins: [vue()],
  }
})