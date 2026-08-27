import process from "node:process";

import {
  evaluateScenario,
  ROLLOUT_PHASES,
  SCENARIOS,
  type EvaluatedRun,
  type RolloutPhase,
} from "./model.js";

type View = "flow" | "sources" | "readiness" | "tools" | "report" | "valuation" | "portfolio" | "rollout" | "acceptance";

const views: readonly View[] = [
  "flow",
  "sources",
  "readiness",
  "tools",
  "report",
  "valuation",
  "portfolio",
  "rollout",
  "acceptance",
];

const bold = (value: string): string => `\x1b[1m${value}\x1b[0m`;
const dim = (value: string): string => `\x1b[2m${value}\x1b[0m`;
const status = (value: string): string => {
  if (["issued", "ready", "complete", "call", "decision_grade", "allowed"].includes(value)) {
    return `\x1b[32m${value}\x1b[0m`;
  }
  if (["withheld", "blocked", "failed", "denied"].includes(value)) {
    return `\x1b[31m${value}\x1b[0m`;
  }
  if (["degraded", "partial", "illustrative", "skip"].includes(value)) {
    return `\x1b[33m${value}\x1b[0m`;
  }
  return `\x1b[36m${value}\x1b[0m`;
};

interface UiState {
  scenarioIndex: number;
  view: View;
  overlayRequested: boolean;
  rolloutPhase: RolloutPhase;
}

const initialScenario = process.argv.find((argument) => argument.startsWith("--scenario="))?.split("=")[1];
const initialView = process.argv.find((argument) => argument.startsWith("--view="))?.split("=")[1] as View | undefined;
const once = process.argv.includes("--once") || !process.stdin.isTTY;

const ui: UiState = {
  scenarioIndex: Math.max(0, SCENARIOS.findIndex((scenario) => scenario.id === initialScenario)),
  view: initialView && views.includes(initialView) ? initialView : "flow",
  overlayRequested: false,
  rolloutPhase: "preview",
};

function row(label: string, value: string): string {
  return `${bold(label.padEnd(22))} ${value}`;
}

function viewFlow(run: EvaluatedRun): string[] {
  return [
    row("Question", run.scenario.question),
    "",
    "Selector → manifest → parallel evidence → analysis → compose → validate → render",
    "             │ canonical store     │ Skill judgment      │ immutable report",
    "",
    row("Subject", `${run.scenario.listing.ticker} ${run.scenario.listing.venue} · ${run.scenario.listing.name}`),
    row("Profile", run.scenario.listing.profile),
    row("Report status", status(run.reportStatus)),
    row("Recommendation", `${status(run.finalRecommendation.state)} · ${run.finalRecommendation.note}`),
    row("Portfolio", `${status(run.portfolioConclusion.state)} · ${run.portfolioConclusion.note}`),
    "",
    ...run.invariants.slice(0, 5).map((invariant) => `• ${invariant}`),
  ];
}

function viewSources(run: EvaluatedRun): string[] {
  return [
    row("Platform", "existing Fastify API + all-in-one /mcp + Postgres research store"),
    row("Routing", `${run.scenario.listing.venue}; marketCode=TW is not a board selector`),
    row("Fallback", "FinMind only when official history is absent; always labelled and reconciled"),
    "",
    ...run.datasets.map(({ id, state }) => `${id.padEnd(31)} ${state.source}`),
    "",
    dim("Publisher ≠ access provider. Raw representation and normalized value are both retained."),
  ];
}

function viewReadiness(run: EvaluatedRun): string[] {
  return [
    row("Fixed context", "effectiveAt=knowledgeAt=2026-08-27T10:00+08:00"),
    row("Selection", "authoritative first; selected_with_conflicts evidence view"),
    "",
    ...run.datasets.map(({ id, state }) => {
      const conflict = state.conflict ? ` conflict=${state.conflict}` : "";
      return `${id.padEnd(31)} ${status(state.readiness).padEnd(18)} ${state.freshness}/${state.completeness}${conflict}`;
    }),
    "",
    dim("Freshness, completeness, confidence, and purpose readiness remain independent."),
  ];
}

function viewTools(run: EvaluatedRun): string[] {
  return [
    row("Authorization", "research:read; overlay also needs portfolio:mcp_read"),
    row("Boundary", "store-only reads; no provider fetch, refresh, valuation, or recommendation tool"),
    "",
    ...run.calls.map(({ tool, action, reason }) => `${status(action).padEnd(15)} ${tool.padEnd(36)} ${reason}`),
  ];
}

function viewReport(run: EvaluatedRun): string[] {
  const sections = [
    "context/readiness",
    "decision summary",
    "identity snapshot",
    "business context",
    "fundamentals",
    "monthly revenue",
    "market context",
    "institutional/positioning",
    "dividends",
    "disclosures/catalysts/risks",
    "valuation/scenarios",
    "watchpoints/invalidation",
    "optional portfolio overlay",
    "evidence/conflicts/provenance",
  ];
  return [
    row("Artifact", "immutable structured ResearchReport; Markdown cannot add claims"),
    row("Operational status", status(run.reportStatus)),
    row("Revenue conclusion", status(run.conclusions.find(({ id }) => id === "revenue_momentum")?.state ?? "withheld")),
    row("Final recommendation", status(run.finalRecommendation.state)),
    "",
    ...sections.map((section, index) => {
      const sectionState = index === 12 && run.portfolioConclusion.state === "not_requested"
        ? "not_requested"
        : section === "valuation/scenarios" && run.scenario.valuation.readiness === "withheld"
          ? "withheld"
          : "rendered";
      return `${String(index + 1).padStart(2)}. ${section.padEnd(34)} ${status(sectionState)}`;
    }),
    "",
    dim("Claims point to evidence [E], assumptions [A], and analytical judgments [J]."),
  ];
}

function money(value: number | undefined): string {
  return value === undefined ? "—" : `TWD ${value.toLocaleString("en-US")}`;
}

function viewValuation(run: EvaluatedRun): string[] {
  const valuation = run.scenario.valuation;
  const marginOfSafety = valuation.base && valuation.settledPrice
    ? `${Math.round(((valuation.base - valuation.settledPrice) / valuation.base) * 100)}%`
    : "withheld";
  return [
    row("Primary method", valuation.primary),
    row("Method fitness", status(valuation.methodFitness)),
    row("Cross-check", valuation.crossCheck),
    row("Readiness", status(valuation.readiness)),
    "",
    row("Bear", money(valuation.bear)),
    row("Base", money(valuation.base)),
    row("Bull", money(valuation.bull)),
    row("Settled close", money(valuation.settledPrice)),
    row("Base margin of safety", marginOfSafety),
    "",
    `• ${valuation.note}`,
    "• Fair value is an envelope, not a target price or probability distribution.",
    "• No method averaging, trailing/forward mixing, or fabricated sector method.",
    "• Every material Base assumption maps to a watchpoint and invalidation condition.",
  ];
}

function viewPortfolio(run: EvaluatedRun): string[] {
  const portfolio = run.scenario.portfolio;
  return [
    row("Requested", ui.overlayRequested ? "yes" : "no"),
    row("Authorization", status(portfolio.access)),
    row("Held", portfolio.held ? "yes" : "no"),
    row("Invested-holdings weight", portfolio.weight === undefined ? "—" : `${(portfolio.weight * 100).toFixed(2)}%`),
    row("Run-scoped policy", portfolio.policy),
    row("Implication", status(run.portfolioConclusion.state)),
    "",
    run.portfolioConclusion.note,
    "",
    "• Core evidence, scenarios, valuation, and recommendation cannot change.",
    "• Cost basis and unrealized P/L are context—not action triggers.",
    "• Hypotheticals stop before transaction drafts, orders, fees, or execution.",
    "• Allowed wording: consider adding / maintaining is consistent / consider reducing.",
  ];
}

function viewRollout(run: EvaluatedRun): string[] {
  return [
    row("Phase", run.rollout.phase),
    row("Acquisition gate", run.rollout.acquisition ? "on" : "off"),
    row("MCP gate", run.rollout.mcp ? "on" : "off"),
    row("Skill gate", run.rollout.skill ? "on" : "off"),
    row("Audience", run.rollout.audience),
    row("Rollback", run.rollout.rollback),
    "",
    "dark → internal canary → explicit user preview → general availability",
    "",
    "Runtime defaults: 60 calls/run · 6 concurrent · 180s · 256KiB/response",
    "Promotion: 3 healthy days → 5 days/20 runs → 10 days/100 runs",
    "Critical integrity/privacy defects disable all research exposure immediately.",
    "Existing portfolio tools, schemas, authorization, and data sources remain stable.",
    "Postgres is durable authority; Redis coordinates but never defines freshness.",
  ];
}

function viewAcceptance(run: EvaluatedRun): string[] {
  return [
    row("G1", "specification handoff"),
    row("G2", "implementation conformance"),
    row("G3", "rollout readiness"),
    row("Matrix", "58 case families · 9 reference roles · immutable evidence manifests"),
    "",
    row("Scenario coverage", run.scenario.acceptanceCases.join(", ")),
    "",
    "Reference subjects:",
    "2330 TWSE golden · 5274 TPEx golden · 0050 ETF · 020032 ETN",
    "2002 cyclical · 2881 unsupported valuation · 2412 DCF cross-check",
    "7811 short history · 5236 venue transfer",
    "",
    "Non-waivable: authorization/privacy, identity/venue, source authority, versions,",
    "canonical integrity, withholding, transaction boundary, and legacy compatibility.",
    "",
    dim("Real subjects prove routing; deterministic fixtures prove adverse states."),
  ];
}

function renderBody(run: EvaluatedRun): string[] {
  const renderers: Record<View, (value: EvaluatedRun) => string[]> = {
    flow: viewFlow,
    sources: viewSources,
    readiness: viewReadiness,
    tools: viewTools,
    report: viewReport,
    valuation: viewValuation,
    portfolio: viewPortfolio,
    rollout: viewRollout,
    acceptance: viewAcceptance,
  };
  return renderers[ui.view](run);
}

function render(): void {
  const scenario = SCENARIOS[ui.scenarioIndex] ?? SCENARIOS[0];
  const run = evaluateScenario(scenario, ui.overlayRequested, ui.rolloutPhase);
  if (!once) process.stdout.write("\x1b[2J\x1b[H");
  const header = `${bold("PROTOTYPE — Taiwan Stock Research V1")} ${dim(`scenario ${ui.scenarioIndex + 1}/${SCENARIOS.length}`)}`;
  const tabs = views.map((view, index) => `${ui.view === view ? bold(String(index + 1)) : String(index + 1)}:${view}`).join("  ");
  const body = renderBody(run);
  process.stdout.write([
    header,
    bold(scenario.title),
    dim(scenario.specialNote),
    tabs,
    "─".repeat(108),
    ...body,
    "─".repeat(108),
    `${bold("n/p")} scenario  ${bold("1–9")} view  ${bold("o")} overlay=${ui.overlayRequested ? "on" : "off"}  ${bold("r")} rollout=${ui.rolloutPhase}  ${bold("q")} quit`,
    "",
  ].join("\n"));
}

function cycleRollout(): void {
  const index = ROLLOUT_PHASES.indexOf(ui.rolloutPhase);
  ui.rolloutPhase = ROLLOUT_PHASES[(index + 1) % ROLLOUT_PHASES.length] ?? "dark";
}

function handleKey(buffer: Buffer): void {
  for (const key of buffer.toString("utf8")) {
    if (key === "q" || key === "\u0003") {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdout.write("\n");
      return;
    }
    if (key === "n") ui.scenarioIndex = (ui.scenarioIndex + 1) % SCENARIOS.length;
    if (key === "p") ui.scenarioIndex = (ui.scenarioIndex - 1 + SCENARIOS.length) % SCENARIOS.length;
    if (/^[1-9]$/.test(key)) ui.view = views[Number(key) - 1] ?? "flow";
    if (key === "o") ui.overlayRequested = !ui.overlayRequested;
    if (key === "r") cycleRollout();
  }
  render();
}

render();
if (!once) {
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on("data", handleKey);
}
