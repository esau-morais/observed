# Verification record

Record these fields per journey. Confirm prerequisites before marking it runnable.

| Field | Required information |
| --- | --- |
| Identity | Recipe ID and version, application revision or snapshot, run ID |
| Contract | Expected behavior and a condition that would falsify it |
| Entry point | Actual route, CLI invocation, or API operation |
| Preconditions | Fixtures, environment, authentication, port and process ownership |
| Actions | Tested commands in order and stable selectors where needed |
| Observations | Resulting UI, response, file, stored state, or event |
| Checks | Comparison and result, separating failures from unavailable observations |
| Artifacts | Raw output, useful screenshots or traces, provenance and redactions |
| Cleanup | Owned resources to stop or remove, with evidence retained |
| Limits | Unexecuted paths, noise, missing permissions, unavailable dependencies |

Map distinct entry points when contracts differ. Checking a CLI action does not check its browser equivalent. Include screenshots when appearance or spatial context matters. Collect the evidence required by the behavior.
