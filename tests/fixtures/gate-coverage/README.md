# Shifted coverage fixture

`counts.ts` is the original source. The served `public/counts.js` adds two
lines and removes TypeScript annotations. Its version 3 map places generated
lines 3 through 9 at original lines 1 through 7. The first two mapping lines
are empty; `AAAA` starts at source 0, line 0, column 0; each `AACA` advances
the original line by one. This fixed table is authored separately from the
collector and comparator.

The candidate replaces both numeric return expressions with equivalent
`Number` calls and updates the embedded source. The saved click calls
`requestedCount` once and never calls `unusedCount`. Raw CDP must therefore
report count 1 at generated line 4 and count 0 at generated line 8. The result
must associate original changed line 2 with execution and line 6 with no
execution, even though the outer module ran.

The runner renames `counts.js.txt` before committing either fixture revision.
The template keeps its exact bytes because the independent expectation pins
its UTF-16 function boundaries. This pair covers a fixed shifted map, not
every bundler's mappings.
