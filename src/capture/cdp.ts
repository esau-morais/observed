import { Effect, Option, Schema, type Scope } from 'effect';

export class CdpFailure extends Schema.TaggedError<CdpFailure>()('CdpFailure', {
  message: Schema.String,
}) {}

const replySchema = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.Int,
    result: Schema.optionalKey(Schema.Unknown),
    error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
  }),
);

const decodeReply = Schema.decodeUnknownOption(replySchema);

export type CdpConnection = {
  // Sends one command and waits for its reply. Interrupting the effect stops
  // waiting; the connection stays open until its scope closes.
  readonly send: (
    method: string,
    params?: Readonly<Record<string, unknown>>,
    sessionId?: string,
  ) => Effect.Effect<unknown, CdpFailure>;
};

type Pending = (reply: Effect.Effect<unknown, CdpFailure>) => void;

const closeTimeoutMs = 2_000;

// Closing waits for the close handshake, so a finished scope leaves no
// DevTools connection open.
const closeSocket = (socket: WebSocket) =>
  Effect.callback<void>((resume) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resume(Effect.void);

      return;
    }

    const timer = setTimeout(() => resume(Effect.void), closeTimeoutMs);

    socket.addEventListener(
      'close',
      () => {
        clearTimeout(timer);
        resume(Effect.void);
      },
      { once: true },
    );
    socket.close();
  });

const openSocket = (url: string, timeoutMs: number) =>
  Effect.callback<WebSocket, CdpFailure>((resume) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      resume(
        Effect.fail(
          new CdpFailure({ message: 'The DevTools connection timed out' }),
        ),
      );
    }, timeoutMs);

    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resume(Effect.succeed(socket));
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        resume(
          Effect.fail(
            new CdpFailure({ message: 'The DevTools connection failed' }),
          ),
        );
      },
      { once: true },
    );

    return Effect.sync(() => {
      clearTimeout(timer);
      socket.close();
    });
  });

// A minimal Chrome DevTools Protocol client over Bun's WebSocket. Commands
// to an attached target pass its sessionId, as flattened sessions require.
export const connectCdp = (
  url: string,
  timeoutMs: number,
): Effect.Effect<CdpConnection, CdpFailure, Scope.Scope> =>
  Effect.gen(function* () {
    const socket = yield* Effect.acquireRelease(
      openSocket(url, timeoutMs),
      closeSocket,
      { interruptible: true },
    );
    const pending = new Map<number, Pending>();
    let nextId = 0;

    socket.addEventListener('message', (event) => {
      const reply = Option.getOrUndefined(decodeReply(event.data));
      const resume = reply === undefined ? undefined : pending.get(reply.id);

      if (reply === undefined || resume === undefined) {
        return;
      }

      pending.delete(reply.id);
      resume(
        reply.error === undefined
          ? Effect.succeed(reply.result)
          : Effect.fail(new CdpFailure({ message: reply.error.message })),
      );
    });
    socket.addEventListener('close', () => {
      for (const resume of pending.values()) {
        resume(
          Effect.fail(
            new CdpFailure({ message: 'The DevTools connection closed' }),
          ),
        );
      }

      pending.clear();
    });

    const send: CdpConnection['send'] = (method, params = {}, sessionId) =>
      Effect.callback<unknown, CdpFailure>((resume) => {
        if (socket.readyState !== WebSocket.OPEN) {
          resume(
            Effect.fail(
              new CdpFailure({ message: 'The DevTools connection is closed' }),
            ),
          );

          return;
        }

        nextId += 1;
        const id = nextId;

        pending.set(id, resume);
        socket.send(
          JSON.stringify(
            sessionId === undefined
              ? { id, method, params }
              : { id, method, params, sessionId },
          ),
        );

        return Effect.sync(() => {
          pending.delete(id);
        });
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () =>
            Effect.fail(
              new CdpFailure({
                message: `DevTools command ${method} timed out after ${timeoutMs / 1000} seconds`,
              }),
            ),
        }),
      );

    return { send };
  });
