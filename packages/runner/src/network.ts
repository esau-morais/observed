import type { BrowserContext, Request } from 'playwright';

export type LoggedRequest = {
  readonly method: string;
  readonly url: URL;
  readonly startedAt: number;
  status: number | null;
};

export function watchNetwork(context: BrowserContext) {
  const requests: LoggedRequest[] = [];
  const open = new Map<Request, LoggedRequest>();
  let lastActivity = Date.now();

  const isHttp = (request: Request) => /^https?:/.test(request.url());

  context.on('request', (request) => {
    if (!isHttp(request)) {
      return;
    }

    const entry: LoggedRequest = {
      method: request.method(),
      url: new URL(request.url()),
      startedAt: Date.now(),
      status: null,
    };

    requests.push(entry);
    open.set(request, entry);
    lastActivity = Date.now();
  });

  const finish = (request: Request, status: number) => {
    const entry = open.get(request);

    if (entry !== undefined) {
      entry.status = status;
      open.delete(request);
      lastActivity = Date.now();
    }
  };

  context.on('requestfinished', (request) => {
    void request.response().then(
      (response) => {
        finish(request, response?.status() ?? 0);
      },
      () => {
        finish(request, 0);
      },
    );
  });
  context.on('requestfailed', (request) => {
    finish(request, 0);
  });

  const idle = async ({ quietMs, timeoutMs }: { quietMs: number; timeoutMs: number }) => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (open.size === 0 && Date.now() - lastActivity >= quietMs) {
        return true;
      }

      await Bun.sleep(25);
    }

    return false;
  };

  return { requests, idle };
}
