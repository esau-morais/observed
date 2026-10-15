import { createInterface } from 'node:readline';

// A scripted agent's side of a newline-delimited JSON-RPC connection.
export const wire = (dialect: 'jsonrpc' | 'codex') => {
  const waiting = new Map<number | string, (message: Record<string, unknown>) => void>();
  const handlers = new Map<string, (params: unknown) => unknown>();
  let nextId = 1000;

  const send = (message: Record<string, unknown>) => {
    process.stdout.write(
      JSON.stringify(dialect === 'jsonrpc' ? { jsonrpc: '2.0', ...message } : message) + '\n',
    );
  };

  createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line) as Record<string, unknown>;
    const id = message.id as number | string | undefined;
    const method = message.method as string | undefined;
    if (method === undefined) {
      if (id !== undefined) waiting.get(id)?.(message);
      return;
    }
    const handler = handlers.get(method);
    if (handler === undefined || id === undefined) return;
    void Promise.resolve(handler(message.params)).then((result) => {
      send({ id, result });
    });
  });

  return {
    on: (method: string, handler: (params: unknown) => unknown) => {
      handlers.set(method, handler);
    },
    notify: (method: string, params: unknown) => {
      send({ method, params });
    },
    ask: (method: string, params: unknown) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const id = nextId++;
        waiting.set(id, resolve);
        send({ id, method, params });
      }),
  };
};

export type Mode = 'edit' | 'ask' | 'crash' | 'stop';
export const mode = (process.argv[2] ?? 'edit') as Mode;
