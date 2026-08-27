# PROTOTYPE — Taiwan Stock Research V1 Decision Explorer

This is throwaway code on a throwaway branch. It is not a production MCP tool, research
Skill, provider integration, valuation engine, portfolio adviser, or transaction workflow.

## Question

Do the decisions in KZO-235 through KZO-244 compose into a coherent end-to-end Taiwan
stock research run, and how do stale, missing, conflicting, unsupported, private-portfolio,
and rollout states change the resulting tools, report, valuation, and conclusions?

The prototype answers that question with deterministic fixtures. It does not call official
sources, the Vakwen database, Linear, providers, an LLM, or any transaction API.

## Run

From the repository root:

```bash
npm run prototype:tw-stock-research-v1
```

Controls:

- `n` / `p` — move between scenarios;
- `1`–`9` — switch among flow, sources, readiness, MCP tools, report, valuation,
  portfolio, rollout, and acceptance;
- `o` — request or remove the private portfolio overlay;
- `r` — advance dark deployment → canary → preview → GA;
- `q` — quit.

For a non-interactive snapshot:

```bash
npm run prototype:tw-stock-research-v1 -- --once --scenario=missing-revenue --view=report
```

## What to look for

- Missing mandatory evidence withholds only dependent conclusions; it does not erase
  independently supported facts or masquerade as `Hold`.
- Missing optional positioning data degrades context without independently blocking the
  final security recommendation.
- ETF and identity-only profiles become explicitly limited rather than flowing through
  operating-company logic.
- MCP retrieves canonical evidence and supported within-dataset metrics. The Skill owns
  cross-dataset synthesis, forecasts, valuation, and conditional conclusions.
- Portfolio access is private and optional. It cannot alter core research, invent a policy,
  or create a transaction draft.
- Research rollout is additive and independently gated; legacy portfolio tools remain
  behaviorally stable.

When the prototype has answered the question, preserve the verdict on KZO-234 and keep
this branch only as the primary-source record. Do not merge the TUI into the implementation.
