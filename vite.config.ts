
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react({
      include: /\.(jsx|tsx)$/,
      babel: {
        plugins: [
          [
            '@locator/babel-jsx/dist',
            { env: 'development' }
          ]
        ]
      }
    })
  ]
})
