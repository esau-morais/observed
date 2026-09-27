export const packageName = '@esau-morais/observed';
export const minimumBun = '1.4.2';

type Build = {
  readonly version: string;
  readonly commit: string | null;
  readonly trackedChanges: boolean;
};

// scripts/build.ts defines this when it bundles the published CLI. Running
// from a checkout leaves it undefined.
declare const OBSERVED_BUILD: Build | undefined;

export const packaged: Build | null =
  typeof OBSERVED_BUILD === 'undefined' ? null : OBSERVED_BUILD;

export function agentBrowserPath(toolRoot: string): string {
  return Bun.resolveSync('agent-browser/bin/agent-browser.js', toolRoot);
}

export function unsupportedBun(): string | null {
  return Bun.semver.order(Bun.version, minimumBun) < 0
    ? `Observed needs Bun ${minimumBun} or later; this is Bun ${Bun.version}. Run \`bun upgrade\`, then try again.`
    : null;
}
