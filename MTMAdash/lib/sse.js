// Server-Sent Events broadcaster. Every connected browser (including the
// wall display) gets change events pushed the instant something is edited.
const clients = new Set();

export function addClient(res) {
  const client = { res, id: Math.random().toString(36).slice(2) };
  clients.add(client);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n\n`);
  send(client, { type: 'hello', at: new Date().toISOString() });

  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      cleanup();
    }
  }, 25000);

  function cleanup() {
    clearInterval(ping);
    clients.delete(client);
  }

  res.on('close', cleanup);
  res.on('error', cleanup);
  return cleanup;
}

function send(client, payload) {
  try {
    client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    clients.delete(client);
  }
}

export function broadcast(payload) {
  const message = { ...payload, at: new Date().toISOString() };
  for (const client of clients) send(client, message);
}

export function clientCount() {
  return clients.size;
}
