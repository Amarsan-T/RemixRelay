import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/chat-backend.test.ts', 'tests/project-management.test.ts'],
    environment: 'edge-runtime',
  },
})
