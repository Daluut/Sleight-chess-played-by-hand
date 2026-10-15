import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import os from 'node:os';

// Lists this PC's LAN IPv4 addresses so the developer knows what to type on the laptop.
function printLanUrl(): Plugin {
  return {
    name: 'print-lan-url',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const addresses = Object.values(os.networkInterfaces())
          .flat()
          .filter((net) => net?.family === 'IPv4' && !net.internal)
          .map((net) => net!.address);
        const port = server.config.server.port ?? 5173;
        console.log('\n  Open this on the laptop (same Wi-Fi):');
        for (const ip of addresses) console.log(`    https://${ip}:${port}`);
        console.log('');
      });
    },
  };
}

export default defineConfig({
  plugins: [basicSsl(), printLanUrl()],
  server: {
    host: true, // listen on 0.0.0.0 so the laptop can connect
    port: 5173,
    proxy: {
      // The FastAPI server on the PC. ws: true lets multiplayer WebSockets pass through too.
      '/api': { target: 'http://localhost:8000', changeOrigin: true, ws: true },
    },
  },
});
