import type { Transport } from "../../src/http/fetcher";

export interface TransportCall {
  url: string;
  init: RequestInit;
}

/** A canned response, a network error to throw, or a function for anything dynamic. */
export type Reply = Response | Error | ((url: string, init: RequestInit) => Response | Promise<Response>);

/**
 * Transport that answers by URL from a queue of replies (the last one repeats); unknown URLs get 404.
 * No request ever leaves the process.
 */
export function fakeTransport(routes: Record<string, Reply | Reply[]>): {
  transport: Transport;
  calls: TransportCall[];
} {
  const calls: TransportCall[] = [];
  const queues = new Map<string, Reply[]>();
  for (const [url, reply] of Object.entries(routes)) {
    queues.set(url, Array.isArray(reply) ? [...reply] : [reply]);
  }
  const transport: Transport = (url, init) => {
    calls.push({ url, init });
    const queue = queues.get(url) ?? [];
    const reply = queue.length > 1 ? queue.shift() : queue[0];
    if (reply === undefined) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }
    if (reply instanceof Error) {
      return Promise.reject(reply);
    }
    if (typeof reply === "function") {
      return Promise.resolve(reply(url, init));
    }
    // A body can be read once; clones let the last reply repeat.
    return Promise.resolve(reply.clone());
  };
  return { transport, calls };
}

export function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
}

export function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

/** A redirect as fetch returns it with redirect "manual": the 3xx itself, with its Location (absolute or relative). */
export function redirectResponse(location: string, status = 301): Response {
  return new Response(null, { status, headers: { Location: location } });
}
