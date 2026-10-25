import { createServer } from 'vite'

// Freeze test pages: a concurrent build/docs edit must not trigger Vite HMR
// navigation halfway through a real-time audio soak or a collaboration test.
const server = await createServer({
  clearScreen: false,
  server: { host: '127.0.0.1', port: Number(process.argv[2]), strictPort: true, hmr: false, watch: null },
})
await server.listen()
server.printUrls()
