#!/usr/bin/env node
import { ExtensionHub } from './hub.js';
import { runStdioServer } from './server.js';

function parseArgs(): { port: number } {
  const defaultPort = process.env.DIORAMA_BRIDGE_PORT
    ? parseInt(process.env.DIORAMA_BRIDGE_PORT, 10)
    : 47831;

  const args = process.argv.slice(2);
  let port = defaultPort;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && i + 1 < args.length) {
      const parsed = parseInt(args[i + 1], 10);
      if (!isNaN(parsed)) {
        port = parsed;
      }
      i++;
    }
  }

  return { port };
}

async function main(): Promise<void> {
  const { port } = parseArgs();

  console.error(`[diorama-bridge] Starting ExtensionHub on ws://127.0.0.1:${port}...`);
  const hub = new ExtensionHub(port);

  hub.on('role-connected', (role, client) => {
    console.error(
      `[diorama-bridge] Client connected: role="${role}", version="${client.extensionVersion}", methods=[${Array.from(client.methods).join(', ')}]`
    );
  });

  hub.on('role-disconnected', (role) => {
    console.error(`[diorama-bridge] Client disconnected: role="${role}"`);
  });

  hub.on('event', (name, data) => {
    console.error(`[diorama-bridge] Event received: ${name}`, data);
  });

  await hub.start();
  console.error(`[diorama-bridge] ExtensionHub listening on ws://127.0.0.1:${port}`);

  await runStdioServer(hub);

  const shutdown = async () => {
    console.error('[diorama-bridge] Shutting down...');
    await hub.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[diorama-bridge] Fatal error:', err);
  process.exit(1);
});
