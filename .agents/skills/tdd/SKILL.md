---
name: tdd
description: Use for an explicitly requested regression test or a bug with a cheap and reliable executable reproduction. Skip test-first work requiring unrelated infrastructure or brittle provider simulations.
---

# Focused regression checks

1. State the broken contract and smallest observable failure.
2. Reuse an existing test or real application recipe when it covers the path.
3. Add a focused test only if it prevents meaningful recurrence. Follow AGENTS.md.
4. Run before the fix. Confirm failure comes from the bug, not setup or compilation.
5. Make the smallest fix and rerun. Check nearby contracts affected by the change.
6. Report before and after evidence. If the prior revision cannot run, state that limit.

Prefer real parsers, comparators, temporary filesystems, and disposable processes over mocking them. A controlled transport failure checks our recovery logic, not the provider's behavior.

Do not test file existence, feature registration, types already checked by the compiler, or incidental markup. Retain targeted UI checks for evidence meaning and essential interactions.

If a useful test needs disproportionate setup, use an executable reproduction, real browser journey, or manual check with saved evidence. Explain the gap. Do not weaken expectations or generate a large suite to satisfy a TDD label.
