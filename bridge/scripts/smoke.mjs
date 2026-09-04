import { ExtensionHub } from '../dist/hub.js';
import { WebSocket } from 'ws';

async function runSmokeTest() {
  console.log('--- Starting ExtensionHub smoke test ---');
  const port = 47839; // test port
  const hub = new ExtensionHub(port);
  await hub.start();
  console.log(`Hub started on port ${port}`);

  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  await new Promise((resolve, reject) => {
    client.on('open', resolve);
    client.on('error', reject);
  });
  console.log('Client connected to hub');

  // Send hello message
  client.send(
    JSON.stringify({
      type: 'hello',
      role: 'background',
      protocol: 1,
      extensionVersion: '0.1.0',
      methods: ['list_tabs'],
    })
  );

  // Wait a bit for registration
  await hub.waitForRole('background', 2000);
  console.log('Role background registered in hub');

  // Handle incoming calls on client
  client.on('message', (data) => {
    const msg = JSON.parse(data.toString('utf-8'));
    if (msg.type === 'call' && msg.method === 'list_tabs') {
      console.log('Client received call:', msg);
      // Reply with result
      client.send(
        JSON.stringify({
          type: 'result',
          id: msg.id,
          ok: true,
          result: {
            tabs: [{ id: 101, url: 'https://example.com', title: 'Example', active: true, windowId: 1 }],
          },
        })
      );
    }
  });

  // Hub calls list_tabs
  console.log('Hub calling list_tabs...');
  const res = await hub.call('list_tabs', {});
  console.log('Hub call returned:', res);

  if (!res.tabs || res.tabs.length !== 1 || res.tabs[0].title !== 'Example') {
    throw new Error('Smoke test failed: unexpected result');
  }

  console.log('Smoke test passed successfully!');
  client.close();
  await hub.stop();
}

runSmokeTest().catch((err) => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
