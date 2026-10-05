import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Comparison } from '../src/comparison-model';
import { encodeGif, type GifFrame } from '../src/gif';
import { agentBrowserPath } from '../src/installation';
import { decodePng } from '../src/png';
import { exportFrames, exportedScene } from '../src/viewer/scene-model';

export type SceneGif =
  { kind: 'written'; frames: number; bytes: number } | { kind: 'none' };

const size = { width: 960, height: 540 };

// The scene the viewer draws, exported as a GIF that plays once: agent-browser
// opens the single-file report in its frame mode, each frame is a screenshot
// after the hash names it, and the GIF encoder joins them. The page is this
// run's own report, so the browser loads nothing from the network.
export async function sceneGif(options: {
  page: string;
  result: Comparison;
  output: string;
  toolRoot: string;
  browserArguments: readonly string[];
}): Promise<SceneGif> {
  const exported = exportedScene(options.result);

  if (exported === null) {
    return { kind: 'none' };
  }

  const plan = exportFrames(exported.scene);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'observed-scene-'));
  const session = `observed-scene-${String(process.pid)}`;
  const run = async (args: readonly string[]) => {
    const child = Bun.spawn(
      [
        process.execPath,
        agentBrowserPath(options.toolRoot),
        '--session',
        session,
        '--headed',
        'false',
        '--no-webmcp',
        ...(options.browserArguments.length === 0
          ? []
          : ['--args', options.browserArguments.join(',')]),
        ...args,
      ],
      {
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          LANG: 'en_US.UTF-8',
          TZ: 'UTC',
          TMPDIR: temporary,
          AGENT_BROWSER_SOCKET_DIR: temporary,
          AGENT_BROWSER_DEFAULT_TIMEOUT: '20000',
        },
        stdout: 'ignore',
        stderr: 'pipe',
      },
    );
    const code = await child.exited;

    if (code !== 0) {
      const detail = (await new Response(child.stderr).text()).trim();

      throw new Error(
        `agent-browser ${args[0] ?? ''} exited with ${String(code)}${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`,
      );
    }
  };

  try {
    const frames: GifFrame[] = [];
    const url = new URL(`file://${path.resolve(options.page)}`);

    url.hash = 'scene-frame=0/1';
    await run(['open', url.href]);
    await run(['set', 'viewport', String(size.width), String(size.height)]);

    for (const [index, frame] of plan.entries()) {
      const name = `${String(frame.beat)}/${String(frame.progress)}`;
      const file = path.join(temporary, `${String(index)}.png`);

      await run(['eval', `location.hash = 'scene-frame=${name}'; 1`]);
      await run(['wait', `[data-scene-frame="${name}"] [data-scene-ready]`]);
      await run(['screenshot', file]);

      const decoded = decodePng(await readFile(file));

      if (decoded.kind !== 'decoded') {
        throw new Error(`Frame ${String(index)} is not a readable PNG`);
      }

      frames.push({ ...decoded.image, delay: frame.delay });
    }

    const bytes = encodeGif(frames);
    await writeFile(options.output, bytes, { flag: 'wx' });

    return {
      kind: 'written',
      frames: frames.length,
      bytes: bytes.length,
    };
  } finally {
    await run(['close']).catch(() => undefined);
    await rm(temporary, { recursive: true, force: true });
  }
}
