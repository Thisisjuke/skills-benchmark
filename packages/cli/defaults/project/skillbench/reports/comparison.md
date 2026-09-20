# Skill comparison

{{sourceA.name}} vs {{sourceB.name}}

## Verdict

- Winner: **{{verdict.winner}}**
- Score A: {{verdict.scoreA}}
- Score B: {{verdict.scoreB}}
- Tie threshold: {{verdict.tieThreshold}}

{{verdict.statement}}

## Sources

- A: **{{sourceA.name}}** — {{sourceA.originalInput}}
- B: **{{sourceB.name}}** — {{sourceB.originalInput}}

## Scope compatibility

**{{scope.compatibility}}** ({{scope.confidence}} confidence)

- Shared: {{scope.shared}}
- Specific to A: {{scope.specificToA}}
- Specific to B: {{scope.specificToB}}

{{#scope.reasons}}- {{value}}
{{/scope.reasons}}

## Scores

| Dimension | A | B | Winner | Effective weight |
|---|---:|---:|:---:|---:|
{{#dimensions}}| {{label}} | {{scoreA}} | {{scoreB}} | {{winner}} | {{effectiveWeight}} |
{{/dimensions}}

## Capability matrix

| Eval capability | A | B | Winner |
|---|---:|---:|:---:|
{{#capabilities}}| {{capability}} | {{scoreA}} | {{scoreB}} | {{winner}} |
{{/capabilities}}{{^capabilities}}| No eval cases | — | — | — |
{{/capabilities}}

## Qualitative judgments

{{#judgments}}- {{evalCaseId}} — {{winner}} ({{confidence}} confidence): {{reasons}}
{{/judgments}}{{^judgments}}No qualitative rubric was evaluated.
{{/judgments}}

## Reproducibility

- Comparison run: {{run.comparisonId}}
- Evaluation A: {{run.evaluationAId}}
- Evaluation B: {{run.evaluationBId}}
- Suite: {{run.suiteId}}
- Partition: {{run.partition}}
- Runner: {{run.runnerType}}
- Runner version: {{run.runnerVersion}}
- Repetitions: {{run.repeat}}
- Timeout: {{run.timeoutMs}} ms
