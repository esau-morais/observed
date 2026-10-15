import { createFileRoute } from '@tanstack/react-router';
import { useEffect, type CSSProperties } from 'react';
import { Chip, Flipbook, Receipt } from '@/components/evidence';
import { horizon, mark, markBlue, nightBlue, paleBlue, rise } from '@/components/fields';
import { GlyphField } from '@/components/glyph-field';
import { Mark } from '@/components/mark';
import { docsUrl, repoUrl } from '@/meta';

export const Route = createFileRoute('/')({
  component: Home,
});

const stagger = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;

const rules = [
  {
    rule: 'A check counts only if it exists at the base revision.',
    why: 'A change runs against the checks from before it, so an agent cannot loosen the test that grades it.',
  },
  {
    rule: 'Missing, skipped or altered evidence is unknown.',
    why: 'If a screenshot is absent or a log was changed, the receipt says unknown. It never rounds that up to a pass.',
  },
  {
    rule: 'Slower than the base means every sample was slower.',
    why: 'Timing is noisy. A check against the base fails only when every candidate sample is slower than every base sample. If the ranges overlap, the result is unknown.',
  },
  {
    rule: 'Observed, never proved.',
    why: 'A journey shows only the cases it ran, so results say observed. Changed code that no journey reaches is reported as a gap, never counted as a pass.',
  },
];

const agents = [
  { name: 'Claude Code', how: 'Agent SDK, or your installed Claude Code' },
  { name: 'Codex', how: 'Codex app-server' },
  { name: 'opencode', how: 'Agent Client Protocol' },
  { name: 'Muse', how: 'Planned' },
];

function useReveal() {
  useEffect(() => {
    const items = [...document.querySelectorAll<HTMLElement>('.pre')];
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const el of items) el.classList.remove('pre');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    );
    for (const el of items) {
      if (el.getBoundingClientRect().top < innerHeight) el.classList.remove('pre');
      else io.observe(el);
    }
    document.documentElement.classList.add('reveal');
    return () => {
      io.disconnect();
    };
  }, []);
}

function Home() {
  useReveal();
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="page">
        <header className="bar">
          <a className="wordmark" href="/">
            <Mark size={22} />
            Observed
          </a>
          <nav aria-label="Main">
            <a className="plain" href="#how">
              How it works
            </a>
            <a className="plain" href="#rules">
              Rules
            </a>
            <a className="plain" href="#agents">
              Agents
            </a>
            <a className="key" href={docsUrl}>
              Docs
            </a>
          </nav>
        </header>

        <main id="main">
          <section className="hero" aria-labelledby="h-hero">
            <div className="hero-copy">
              <h1 className="display lines" id="h-hero">
                <span className="line">
                  <span data-line style={stagger(0)}>
                    See what changed.
                  </span>
                </span>
              </h1>
              <p className="lead" data-rise style={stagger(0)}>
                Observed runs your coding agent, then runs your app on both revisions and shows what
                the change did. Checks written before the change decide what holds. No model gets a
                vote.
              </p>
              <div className="actions" data-rise style={stagger(1)}>
                <a className="button" href={docsUrl}>
                  Read the docs
                </a>
                <a className="key key-lg" href={repoUrl}>
                  View the source
                </a>
              </div>
              <p className="hero-meta micro" data-rise style={stagger(2)}>
                <span>Being rebuilt</span>
                <span>MIT licensed</span>
                <span>Claude Code, Codex, opencode, Muse</span>
              </p>
            </div>

            <div className="hero-frag" data-rise style={stagger(3)}>
              <figure className="card" data-ui>
                <figcaption className="cardbar">
                  <span>
                    <span className="lights" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <strong>shop</strong> · Disable checkout while saving
                  </span>
                  <span>Example turn</span>
                </figcaption>
                <Flipbook />
                <div className="legend">
                  <Chip state="checked">button disabled</Chip>
                  <Chip state="checked">one POST /orders</Chip>
                  <Chip state="changed">label text</Chip>
                </div>
              </figure>
              <Receipt />
            </div>
          </section>
        </main>
      </div>

      <section className="band night judge" id="how" aria-labelledby="h-how">
        <div className="judge-sky">
          <GlyphField field={horizon} colors={nightBlue} size={17} glow={7} />
        </div>
        <div className="page statement">
          <h2 className="display pre" id="h-how">
            The agent writes. The code judges.
          </h2>
          <div className="three">
            <p className="pre" style={stagger(0)}>
              <strong>Your agent makes the change.</strong>
              Claude Code, Codex, opencode or Muse writes it, as it does today.
            </p>
            <p className="pre" style={stagger(1)}>
              <strong>Observed runs both revisions.</strong>
              It drives your app on the base and on the candidate and records screenshots, requests
              and errors.
            </p>
            <p className="pre" style={stagger(2)}>
              <strong>Checks from the base decide.</strong>
              The verdict comes from code with no model in it, and every claim points at its
              evidence.
            </p>
          </div>
          <figure className="twin pre" style={stagger(3)}>
            <pre aria-hidden="true">
              <u>BASE 83f756f</u>
              {'               '}
              <u>CANDIDATE 9c1e2aa</u>
              {`
+----------------------+   +----------------------+
| Checkout     2 items |   | Checkout     2 items |
| Linen tote    $32.00 |   | Linen tote    $32.00 |
| Shipping      $16.00 |   | Shipping      $16.00 |
| Total         $48.00 |   | Total         $48.00 |
| ( Pay $48.00    -> ) |   | ( Saving... )        |
+----------------------+   +----------------------+
POST /orders  `}
              <i>x2</i>
              {'           POST /orders  '}
              <b>x1</b>
              {`

`}
              <b>[ok]</b>
              {' button disabled      holds on candidate\n'}
              <b>[ok]</b>
              {' one POST /orders     2 -> 1\n'}
              <i>[~]</i>
              {'  label text           "Pay" -> "Saving..."'}
            </pre>
            <figcaption className="micro">
              Every view also prints as plain text, so the same evidence fits a terminal, a PR
              comment or a screen reader.
            </figcaption>
            <p className="sr-only">
              Base: the Pay button is active and one click sends two POST /orders requests.
              Candidate: the button reads Saving and is disabled, and one click sends one request.
            </p>
          </figure>
        </div>
      </section>

      <section className="band blue" id="rules" aria-labelledby="h-rules">
        <div className="page memo">
          <p className="stamp" aria-hidden="true">
            NO MODEL
            <br />
            VOTES
          </p>
          <div className="memo-head pre">
            <h2 className="head" id="h-rules">
              Unknown is never a pass.
            </h2>
            <p className="memo-lead">
              The judge is the part of Observed that decides what holds. It imports no model SDK and
              follows four rules.
            </p>
          </div>
          <ol className="rules">
            {rules.map((r, i) => (
              <li className="rule pre" key={r.rule} style={stagger(i)}>
                <p className="rule-head">{r.rule}</p>
                <p>{r.why}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band dots" id="agents" aria-labelledby="h-agents">
        <div className="page agents">
          <div className="agents-head pre">
            <h2 className="head" id="h-agents">
              Bring your agent.
            </h2>
            <p>
              Each agent gets a thin adapter, so nothing depends on hooks inside someone else&apos;s
              tool. Claude Code comes first. The adapters are in progress.
            </p>
          </div>
          <ul className="agent-list">
            {agents.map((a, i) => (
              <li className="agent pre" key={a.name} style={stagger(i)}>
                <span className="agent-name">{a.name}</span>
                <span className="micro">{a.how}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="page">
        <footer className="tiles">
          <div className="tile t-mark">
            <GlyphField
              field={mark}
              colors={markBlue}
              size={12}
              word="EVIDENCE"
              wordAt={0.58}
              glow={3}
            />
            <p className="name">Observed</p>
            <p className="micro">Observed, never proved. MIT licensed.</p>
          </div>
          <nav className="tile t-nav" aria-label="Footer">
            <ul>
              <li>
                <a href={docsUrl}>Docs</a>
              </li>
              <li>
                <a href={repoUrl}>GitHub</a>
              </li>
              <li>
                <a href={`${repoUrl}/blob/main/CHANGELOG.md`}>Changelog</a>
              </li>
              <li>
                <a href={`${repoUrl}/blob/main/LICENSE`}>License</a>
              </li>
            </ul>
          </nav>
          <a className="tile t-go" href="#main">
            <GlyphField
              field={rise}
              colors={paleBlue}
              size={11}
              word="EVIDENCE"
              wordAt={0.9}
              alpha={0.5}
            />
            <span>Back to the top</span>
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
              <path
                d="M22 38V8M9 20 22 7l13 13"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="square"
              />
            </svg>
          </a>
        </footer>
      </div>
    </>
  );
}
