// Scripted `fetch` for the gateway unit tests: one reply per call, in order, and a log
// of what was sent. No socket is ever opened.

export type FakeReply =
  | { status: number; body?: unknown; text?: string; headers?: Record<string, string> }
  | { error: Error }
  | 'hang'; // settles only when the request signal aborts (rejects with its reason)

export type FakeCall = { method: string; url: URL; headers: Headers; body: unknown; signal: AbortSignal | null };

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function toResponse(reply: { status: number; body?: unknown; text?: string; headers?: Record<string, string> }): Response {
  const payload = reply.text ?? (reply.body === undefined ? null : JSON.stringify(reply.body));
  const contentType = reply.text === undefined ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
  return new Response(payload, { status: reply.status, headers: { 'content-type': contentType, ...reply.headers } });
}

function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) return; // never settles: a gateway without a signal would hang forever
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

export function createFakeFetch(replies: FakeReply[]): typeof fetch & { calls: FakeCall[] } {
  const queue = [...replies];
  const calls: FakeCall[] = [];
  const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ method: init?.method ?? 'GET', url, headers: new Headers(init?.headers), body: parseBody(init?.body), signal: init?.signal ?? null });
    const reply = queue.shift();
    if (reply === undefined) return Promise.reject(new Error('fake fetch: no reply left'));
    if (reply === 'hang') return hang(init?.signal);
    if ('error' in reply) return Promise.reject(reply.error);
    return Promise.resolve(toResponse(reply));
  };
  return Object.assign(fake as typeof fetch, { calls });
}
