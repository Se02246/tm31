import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function copyToPublic() {
  return {
    name: 'copy-to-public',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist')
      const publicDir = path.resolve(__dirname, '../public')
      if (fs.existsSync(distDir) && fs.existsSync(publicDir)) {
        fs.cpSync(distDir, publicDir, { recursive: true, force: true })
        console.log('✅ [VITE] File compilati copiati automaticamente in public/')
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    copyToPublic()
  ],
})
