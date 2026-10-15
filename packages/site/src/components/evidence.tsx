import { useState } from 'react';

const bitmaps = {
  check: ['.....#', '....##', '#..##.', '####..', '.##...', '......'],
  delta: ['..##..', '..##..', '.#..#.', '.#..#.', '######', '......'],
  unknown: ['.####.', '#....#', '...##.', '..#...', '......', '..#...'],
};

type State = 'checked' | 'changed' | 'unknown';

const stateIcon: Record<State, keyof typeof bitmaps> = {
  checked: 'check',
  changed: 'delta',
  unknown: 'unknown',
};

function Pixel({ name }: { name: keyof typeof bitmaps }) {
  const rows = bitmaps[name];
  return (
    <svg className="pix" width={12} height={12} viewBox="0 0 6 6" aria-hidden="true">
      {rows.flatMap((row, y) =>
        Array.from(row, (c, x) =>
          c === '#' ? <rect key={String(x * 6 + y)} x={x} y={y} width={1} height={1} /> : null,
        ),
      )}
    </svg>
  );
}

export function Chip({ state, children }: { state: State; children: React.ReactNode }) {
  return (
    <span className={`chip chip-${state}`}>
      <Pixel name={stateIcon[state]} />
      {children}
    </span>
  );
}

function Screen({ side }: { side: 'before' | 'after' }) {
  return (
    <div className={`screen screen-${side}`} aria-hidden="true">
      <div className="screen-top">
        <strong>Checkout</strong>
        {side === 'after' ? (
          <Chip state="checked">1 request</Chip>
        ) : (
          <span className="soft">2 items</span>
        )}
      </div>
      <div>
        <div className="item">
          <span>Linen tote</span>
          <span>$32.00</span>
        </div>
        <div className="item">
          <span>Shipping</span>
          <span>$16.00</span>
        </div>
        <div className="item total">
          <span>Total</span>
          <span>$48.00</span>
        </div>
      </div>
      {side === 'before' ? (
        <span className="pay">
          <span>Pay $48.00</span>
          <span>→</span>
        </span>
      ) : (
        <span className="pay">
          <span>Saving…</span>
          <span>disabled</span>
        </span>
      )}
    </div>
  );
}

export function Flipbook() {
  const [split, setSplit] = useState(50);
  return (
    <div className="flip" style={{ '--split': `${String(split)}%` } as React.CSSProperties}>
      <Screen side="before" />
      <Screen side="after" />
      <span className="lane lane-before">Base</span>
      <span className="lane lane-after">Candidate</span>
      <span className="handle" aria-hidden="true">
        <span className="grip" />
      </span>
      <input
        className="flip-range"
        type="range"
        min={0}
        max={100}
        value={split}
        onChange={(e) => {
          setSplit(Number(e.target.value));
        }}
        aria-label="Show more of the base or the candidate"
        aria-valuetext={`${String(split)} percent base`}
      />
      <p className="sr-only">
        On the base revision the Pay button is active and one click sends two POST /orders requests.
        On the candidate the button reads Saving and is disabled, and one click sends one request.
      </p>
    </div>
  );
}

const receipt: readonly (readonly [State, string, string])[] = [
  ['changed', 'Screenshot', '1840 pixels in 1 region'],
  ['changed', 'Requests', '1 request fewer on the candidate'],
  ['checked', 'One POST /orders per click', 'base 2 · candidate 1 · exactly 1'],
  [
    'checked',
    'Button reads Saving… while saving',
    'Exactly one button element with text "Saving…".',
  ],
];

export function Receipt() {
  return (
    <div className="receipt" role="group" aria-label="Example receipt">
      <p className="receipt-head">Pay for the order</p>
      {receipt.map(([state, subject, evidence]) => (
        <p className="receipt-line" key={subject}>
          <span className={`receipt-state receipt-${state}`}>{state}</span>
          <span>
            {subject}
            <span className="receipt-evidence">{evidence}</span>
          </span>
        </p>
      ))}
      <hr />
      <p className="receipt-foot">No regression · 2 checked, 2 changed, 0 unknown, 0 failed</p>
    </div>
  );
}
