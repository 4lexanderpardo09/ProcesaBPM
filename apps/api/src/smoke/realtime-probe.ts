/**
 * The smallest Socket.IO client that proves a deployment's realtime endpoint works through its reverse proxy: it speaks
 * the wire protocol (engine.io v4 over a WebSocket, then a Socket.IO CONNECT packet carrying the token in `auth`) with
 * Node's own WebSocket, so the smoke test needs no extra dependency in the image.
 */
export type ProbeResult = { readonly outcome: 'CONNECTED' } | { readonly outcome: 'REFUSED'; readonly code: string } | { readonly outcome: 'NOT_UPGRADED' };

const ENGINE_OPEN = '0';
const SOCKET_CONNECT = '40';
const SOCKET_CONNECT_ERROR = '44';
const TIMEOUT_MS = 10_000;

export function realtimeUrl(baseUrl: string): string {
  const url = new URL('/realtime/', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = 'EIO=4&transport=websocket';
  return url.toString();
}

/** Opens the socket with the given `Origin` and token and says how the server answered. */
export function probeRealtime(baseUrl: string, options: { readonly origin: string; readonly token: string }): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    // `headers` is an undici extension of the WebSocket constructor (the standard one cannot set the Origin of a server-side client).
    const socket = new WebSocket(realtimeUrl(baseUrl), { headers: { origin: options.origin } } as unknown as string[]);
    let settled = false;
    const closeQuietly = () => {
      try {
        socket.close();
      } catch {
        // Already closing or closed: nothing left to do.
      }
    };
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeQuietly();
      resolve(result);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      closeQuietly();
      reject(new Error(`The realtime endpoint did not answer within ${TIMEOUT_MS / 1000} s`));
    }, TIMEOUT_MS);
    socket.addEventListener('error', () => finish({ outcome: 'NOT_UPGRADED' }));
    socket.addEventListener('close', () => finish({ outcome: 'NOT_UPGRADED' }));
    socket.addEventListener('message', (event) => {
      const packet = String(event.data);
      if (packet.startsWith(ENGINE_OPEN)) socket.send(`${SOCKET_CONNECT}${JSON.stringify({ token: options.token })}`);
      else if (packet.startsWith(SOCKET_CONNECT_ERROR)) finish({ outcome: 'REFUSED', code: codeOf(packet.slice(SOCKET_CONNECT_ERROR.length)) });
      else if (packet.startsWith(SOCKET_CONNECT)) finish({ outcome: 'CONNECTED' });
      else if (packet === '2') socket.send('3');
    });
  });
}

function codeOf(payload: string): string {
  try {
    return String((JSON.parse(payload) as { data?: { code?: unknown } }).data?.code ?? 'UNKNOWN');
  } catch {
    return 'UNKNOWN';
  }
}
