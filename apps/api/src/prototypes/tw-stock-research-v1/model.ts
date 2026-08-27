export const DATASET_IDS = [
  "research_identity",
  "price_series",
  "exchange_valuation_references",
  "monthly_revenue",
  "financial_statements",
  "institutional_trading",
  "foreign_ownership",
  "margin_and_short_balances",
  "dividend_events",
  "material_announcements",
  "investor_materials",
] as const;

export type DatasetId = (typeof DATASET_IDS)[number];
export type Profile = "operating_company" | "etf_limited" | "identity_only";
export type Readiness = "ready" | "degraded" | "blocked" | "not_applicable";
export type RolloutPhase = "dark" | "canary" | "preview" | "ga";

export interface DatasetState {
  freshness: "current" | "stale" | "not_applicable";
  completeness: "complete" | "partial" | "empty" | "not_applicable";
  confidence: "verified" | "supported" | "provisional" | "indeterminate";
  readiness: Readiness;
  source: string;
  note: string;
  conflict?: "non_material" | "decision_material";
}

interface Listing {
  ticker: string;
  venue: "TWSE" | "TPEX";
  name: string;
  profile: Profile;
}

interface ValuationFixture {
  primary: "earnings_multiple" | "fcff_dcf" | "none";
  crossCheck: "fcff_dcf" | "peer_range" | "none";
  readiness: "decision_grade" | "illustrative" | "withheld" | "not_applicable";
  methodFitness: "fit" | "cross_check_only" | "unfit" | "indeterminate" | "not_applicable";
  bear?: number;
  base?: number;
  bull?: number;
  settledPrice?: number;
  note: string;
}

interface PortfolioFixture {
  access: "allowed" | "denied";
  held: boolean;
  weight?: number;
  policy: "complete" | "missing";
  implication: string;
}

export interface Scenario {
  id: string;
  title: string;
  question: string;
  listing: Listing;
  overrides?: Partial<Record<DatasetId, Partial<DatasetState>>>;
  valuation: ValuationFixture;
  portfolio: PortfolioFixture;
  acceptanceCases: readonly string[];
  specialNote: string;
}

export interface Conclusion {
  id: string;
  state: "issued" | "withheld" | "not_applicable" | "not_requested";
  note: string;
}

export interface EvaluatedRun {
  scenario: Scenario;
  datasets: ReadonlyArray<{ id: DatasetId; state: DatasetState }>;
  calls: ReadonlyArray<{ tool: string; action: "call" | "skip"; reason: string }>;
  reportStatus: "complete" | "partial" | "failed";
  conclusions: readonly Conclusion[];
  finalRecommendation: Conclusion;
  portfolioConclusion: Conclusion;
  rollout: {
    phase: RolloutPhase;
    acquisition: boolean;
    mcp: boolean;
    skill: boolean;
    audience: string;
    rollback: string;
  };
  invariants: readonly string[];
}

const authoritativeSources: Record<DatasetId, string> = {
  research_identity: "TWSE/TPEx official listings",
  price_series: "TWSE/TPEx official trading facts",
  exchange_valuation_references: "TWSE/TPEx official references",
  monthly_revenue: "MOPS issuer filings",
  financial_statements: "MOPS filed XBRL",
  institutional_trading: "TWSE/TPEx official trading facts",
  foreign_ownership: "TWSE/TPEx official ownership facts",
  margin_and_short_balances: "TWSE/TPEx official balance facts",
  dividend_events: "MOPS decisions + exchange results",
  material_announcements: "MOPS official announcements",
  investor_materials: "issuer-filed official artifacts",
};

const requiredForRecommendation = new Set<DatasetId>([
  "research_identity",
  "price_series",
  "monthly_revenue",
  "financial_statements",
  "material_announcements",
]);

const toolByDataset: Record<DatasetId, string> = {
  research_identity: "get_research_identity",
  price_series: "get_price_series",
  exchange_valuation_references: "get_exchange_valuation_references",
  monthly_revenue: "get_monthly_revenue",
  financial_statements: "get_financial_statements",
  institutional_trading: "get_institutional_trading",
  foreign_ownership: "get_foreign_ownership",
  margin_and_short_balances: "get_margin_and_short_balances",
  dividend_events: "get_dividend_events",
  material_announcements: "list_material_announcements",
  investor_materials: "list_investor_materials",
};

function baseDatasetState(id: DatasetId, profile: Profile): DatasetState {
  const applicable =
    profile === "operating_company" ||
    id === "research_identity" ||
    (profile === "etf_limited" && (id === "price_series" || id === "dividend_events"));

  if (!applicable) {
    return {
      freshness: "not_applicable",
      completeness: "not_applicable",
      confidence: "verified",
      readiness: "not_applicable",
      source: authoritativeSources[id],
      note: "Excluded by the effective security profile",
    };
  }

  return {
    freshness: "current",
    completeness: "complete",
    confidence: "verified",
    readiness: "ready",
    source: authoritativeSources[id],
    note: "Authoritative evidence selected",
  };
}

function listing(
  ticker: string,
  venue: "TWSE" | "TPEX",
  name: string,
  profile: Profile = "operating_company",
): Listing {
  return { ticker, venue, name, profile };
}

const standardValuation: ValuationFixture = {
  primary: "earnings_multiple",
  crossCheck: "peer_range",
  readiness: "decision_grade",
  methodFitness: "fit",
  bear: 780,
  base: 990,
  bull: 1_190,
  settledPrice: 940,
  note: "One primary method; peers support but are not blended",
};

const noPortfolio: PortfolioFixture = {
  access: "allowed",
  held: false,
  policy: "missing",
  implication: "Factual zero exposure only; no intent to buy is inferred",
};

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "ready-twse",
    title: "Ready TWSE operating company",
    question: "What does a complete, decision-grade run look like?",
    listing: listing("2330", "TWSE", "TSMC"),
    valuation: standardValuation,
    portfolio: noPortfolio,
    acceptanceCases: ["DATA-001", "MCP-001", "REPORT-001", "VAL-001"],
    specialNote: "The happy path still exposes lineage, policy versions, and purpose-specific readiness.",
  },
  {
    id: "ready-tpex",
    title: "Ready TPEx operating company",
    question: "Does the same contract route correctly by board?",
    listing: listing("5274", "TPEX", "ASPEED"),
    valuation: { ...standardValuation, bear: 2_700, base: 3_250, bull: 3_900, settledPrice: 3_050 },
    portfolio: noPortfolio,
    acceptanceCases: ["DATA-001", "DATA-002", "REPORT-002"],
    specialNote: "marketCode=TW is context; listingVenue=TPEX is the routing key.",
  },
  {
    id: "missing-revenue",
    title: "Latest monthly revenue missing",
    question: "Can useful research survive while the action conclusion is withheld?",
    listing: listing("2330", "TWSE", "TSMC"),
    overrides: {
      monthly_revenue: {
        freshness: "stale",
        completeness: "empty",
        confidence: "indeterminate",
        readiness: "blocked",
        note: "Latest due month is not published after the grace boundary",
      },
    },
    valuation: standardValuation,
    portfolio: noPortfolio,
    acceptanceCases: ["DATA-003", "DATA-004", "REPORT-006"],
    specialNote: "Report status may remain complete because the missing result was evaluated deterministically.",
  },
  {
    id: "material-conflict",
    title: "Decision-material financial conflict",
    question: "What happens when authority selects a value but the discrepancy can reverse a conclusion?",
    listing: listing("2330", "TWSE", "TSMC"),
    overrides: {
      financial_statements: {
        readiness: "blocked",
        confidence: "supported",
        conflict: "decision_material",
        note: "Authoritative and fallback values disagree across a decision threshold",
      },
    },
    valuation: {
      ...standardValuation,
      readiness: "withheld",
      methodFitness: "indeterminate",
      note: "Authority selection does not erase a decision-material conflict",
    },
    portfolio: noPortfolio,
    acceptanceCases: ["DATA-005", "REPORT-006", "MCP-006"],
    specialNote: "Both observations and the open conflict remain visible; values are never averaged.",
  },
  {
    id: "optional-degraded",
    title: "Optional positioning evidence unavailable",
    question: "Which defects degrade the report without blocking the recommendation?",
    listing: listing("2330", "TWSE", "TSMC"),
    overrides: {
      institutional_trading: {
        freshness: "stale",
        completeness: "partial",
        confidence: "provisional",
        readiness: "degraded",
        note: "Provider route unavailable after retained evidence became stale",
      },
      foreign_ownership: {
        completeness: "empty",
        confidence: "indeterminate",
        readiness: "degraded",
        note: "Optional context is unavailable",
      },
    },
    valuation: standardValuation,
    portfolio: noPortfolio,
    acceptanceCases: ["REPORT-007", "DATA-003", "OPS-005"],
    specialNote: "Optional evidence is mandatory only for conclusions that consume it.",
  },
  {
    id: "etf-limited",
    title: "ETF-limited profile",
    question: "How does V1 avoid pretending an ETF is an operating company?",
    listing: listing("0050", "TWSE", "Yuanta Taiwan 50 ETF", "etf_limited"),
    valuation: {
      primary: "none",
      crossCheck: "none",
      readiness: "not_applicable",
      methodFitness: "not_applicable",
      settledPrice: 68,
      note: "Operating-company valuation is outside the V1 ETF surface",
    },
    portfolio: { ...noPortfolio, held: true, weight: 0.18 },
    acceptanceCases: ["MCP-002", "REPORT-003", "PORT-006"],
    specialNote: "Only identity, price, distributions, and factual portfolio context apply.",
  },
  {
    id: "unsupported-sector",
    title: "No fit common valuation method",
    question: "Can the system succeed without manufacturing a fair value?",
    listing: listing("2881", "TWSE", "Fubon Financial"),
    valuation: {
      primary: "none",
      crossCheck: "none",
      readiness: "withheld",
      methodFitness: "unfit",
      settledPrice: 92,
      note: "V1 does not improvise P/B, DDM, excess-return, or liquidation methods",
    },
    portfolio: noPortfolio,
    acceptanceCases: ["VAL-001", "VAL-002", "REPORT-006"],
    specialNote: "Withheld is a successful, honest outcome—not a neutral rating.",
  },
  {
    id: "dcf-cross-check",
    title: "Earnings primary with DCF cross-check",
    question: "How do multiple valuation methods coexist without blending?",
    listing: listing("2412", "TWSE", "Chunghwa Telecom"),
    valuation: {
      primary: "earnings_multiple",
      crossCheck: "fcff_dcf",
      readiness: "decision_grade",
      methodFitness: "fit",
      bear: 112,
      base: 126,
      bull: 139,
      settledPrice: 124,
      note: "DCF is separately gated and reconciled; it is never averaged into the primary envelope",
    },
    portfolio: noPortfolio,
    acceptanceCases: ["VAL-001", "VAL-004", "VAL-006"],
    specialNote: "Terminal-value share, WACC, growth, and equity bridge stay explicit.",
  },
  {
    id: "short-history",
    title: "Short listing history",
    question: "How are insufficient windows represented without stitching predecessor history?",
    listing: listing("7811", "TPEX", "Minson Integration"),
    overrides: {
      price_series: {
        completeness: "partial",
        readiness: "degraded",
        note: "Pre-listing sessions are not_expected; 252-session claims are withheld",
      },
    },
    valuation: {
      ...standardValuation,
      readiness: "illustrative",
      methodFitness: "cross_check_only",
      note: "Comparable history is insufficient for decision-grade multiple support",
    },
    portfolio: noPortfolio,
    acceptanceCases: ["DATA-008", "MCP-002", "REPORT-006"],
    specialNote: "Point-in-time facts can render while history-dependent claims are withheld.",
  },
  {
    id: "venue-transfer-history",
    title: "Historical venue transfer",
    question: "Does an immutable Listing prevent future leakage and accidental history stitching?",
    listing: listing("5236", "TWSE", "Sunplus Innovation"),
    overrides: {
      price_series: {
        completeness: "partial",
        readiness: "degraded",
        note: "The selected TWSE Listing begins at transfer; predecessor TPEx Listing is only referenced",
      },
    },
    valuation: {
      ...standardValuation,
      readiness: "illustrative",
      note: "Per-share comparison waits for compatible post-transfer evidence",
    },
    portfolio: noPortfolio,
    acceptanceCases: ["DATA-002", "DATA-010", "MCP-003"],
    specialNote: "effectiveAt and knowledgeAt are fixed; the Listing ID never silently follows a transfer.",
  },
  {
    id: "portfolio-policy",
    title: "Authorized held position with action policy",
    question: "How can position-aware implications remain separate from research and execution?",
    listing: listing("2330", "TWSE", "TSMC"),
    valuation: standardValuation,
    portfolio: {
      access: "allowed",
      held: true,
      weight: 0.08,
      policy: "complete",
      implication: "Conditions support considering an addition under the stated horizon and limits",
    },
    acceptanceCases: ["PORT-001", "PORT-004", "PORT-005", "PORT-007"],
    specialNote: "The overlay evaluates user rules after core research; it never creates a transaction draft.",
  },
  {
    id: "portfolio-denied",
    title: "Portfolio overlay denied",
    question: "Does private portfolio denial leave public research unchanged?",
    listing: listing("2330", "TWSE", "TSMC"),
    valuation: standardValuation,
    portfolio: {
      access: "denied",
      held: false,
      policy: "missing",
      implication: "Overlay withheld; ownership is not probed or exposed",
    },
    acceptanceCases: ["PORT-001", "PORT-002", "MCP-007"],
    specialNote: "Core research and its recommendation are identical with or without portfolio access.",
  },
] as const;

const rolloutByPhase: Record<RolloutPhase, EvaluatedRun["rollout"]> = {
  dark: {
    phase: "dark",
    acquisition: true,
    mcp: false,
    skill: false,
    audience: "operators only; surface undiscoverable",
    rollback: "disable acquisition or quarantine a dataset without touching legacy tools",
  },
  canary: {
    phase: "canary",
    acquisition: true,
    mcp: true,
    skill: true,
    audience: "explicit expiring operator allowlist",
    rollback: "scope to dataset/board/tool; global research kill switch remains available",
  },
  preview: {
    phase: "preview",
    acquisition: true,
    mcp: true,
    skill: true,
    audience: "users who explicitly grant research:read",
    rollback: "preserve grants and legacy tools; return research_temporarily_unavailable",
  },
  ga: {
    phase: "ga",
    acquisition: true,
    mcp: true,
    skill: true,
    audience: "new connectors default on; existing connectors unchanged",
    rollback: "permanent scoped/global gates, quarantine, rebuild, and report invalidation",
  },
};

function evaluateDatasets(scenario: Scenario): EvaluatedRun["datasets"] {
  return DATASET_IDS.map((id) => {
    const base = baseDatasetState(id, scenario.listing.profile);
    return { id, state: { ...base, ...scenario.overrides?.[id] } };
  });
}

function conclusion(
  id: string,
  state: Conclusion["state"],
  note: string,
): Conclusion {
  return { id, state, note };
}

export function evaluateScenario(
  scenario: Scenario,
  overlayRequested: boolean,
  rolloutPhase: RolloutPhase,
): EvaluatedRun {
  const datasets = evaluateDatasets(scenario);
  const blockedMandatory = datasets.filter(
    ({ id, state }) => requiredForRecommendation.has(id) && state.readiness === "blocked",
  );
  const materialConflicts = datasets.filter(({ state }) => state.conflict === "decision_material");
  const optionalDegradation = datasets.some(
    ({ id, state }) => !requiredForRecommendation.has(id) && state.readiness === "degraded",
  );

  const valuationUsable = scenario.valuation.readiness === "decision_grade";
  const recommendationApplicable = scenario.listing.profile === "operating_company";
  const recommendationIssued =
    recommendationApplicable &&
    blockedMandatory.length === 0 &&
    materialConflicts.length === 0 &&
    valuationUsable;

  const finalRecommendation = !recommendationApplicable
    ? conclusion("security_recommendation", "not_applicable", "Profile excludes operating-company action semantics")
    : recommendationIssued
      ? conclusion(
          "security_recommendation",
          "issued",
          optionalDegradation
            ? "Conditional thesis issued with optional-evidence degradation"
            : "Conditional thesis issued; never converted to Buy/Hold/Sell",
        )
      : conclusion(
          "security_recommendation",
          "withheld",
          [
            ...blockedMandatory.map(({ id }) => id),
            ...materialConflicts.map(({ id }) => `${id}:conflict`),
            ...(valuationUsable ? [] : ["valuation"]),
          ].join(", ") || "a mandatory gate failed",
        );

  let portfolioConclusion: Conclusion;
  if (!overlayRequested) {
    portfolioConclusion = conclusion("portfolio_implication", "not_requested", "Core research never probes ownership");
  } else if (scenario.portfolio.access === "denied") {
    portfolioConclusion = conclusion("portfolio_implication", "withheld", scenario.portfolio.implication);
  } else if (scenario.listing.profile === "etf_limited") {
    portfolioConclusion = conclusion(
      "portfolio_implication",
      "not_applicable",
      "ETF facts may render, but V1 has no ETF action semantics",
    );
  } else if (scenario.portfolio.policy === "complete" && recommendationIssued) {
    portfolioConclusion = conclusion("portfolio_implication", "issued", scenario.portfolio.implication);
  } else {
    portfolioConclusion = conclusion(
      "portfolio_implication",
      "withheld",
      scenario.portfolio.held
        ? "Factual exposure is available, but no complete run-scoped action policy exists"
        : scenario.portfolio.implication,
    );
  }

  const conclusions: Conclusion[] = [
    conclusion("fundamental_thesis", scenario.listing.profile === "operating_company" ? "issued" : "not_applicable", "Independently gated"),
    conclusion(
      "revenue_momentum",
      datasets.find(({ id }) => id === "monthly_revenue")?.state.readiness === "blocked"
        ? "withheld"
        : scenario.listing.profile === "operating_company"
          ? "issued"
          : "not_applicable",
      "Requires the latest due revenue and declared comparison windows",
    ),
    conclusion("market_context", "issued", "Price facts do not become technical trading signals"),
    conclusion(
      "valuation",
      scenario.valuation.readiness === "decision_grade"
        ? "issued"
        : scenario.valuation.readiness === "not_applicable"
          ? "not_applicable"
          : "withheld",
      scenario.valuation.note,
    ),
    finalRecommendation,
    portfolioConclusion,
  ];

  const calls: EvaluatedRun["calls"] = [
    { tool: "get_research_manifest", action: "call", reason: "fix identity, context, capabilities, and policy versions" },
    ...datasets.map(({ id, state }) => ({
      tool: toolByDataset[id],
      action: state.readiness === "not_applicable" ? ("skip" as const) : ("call" as const),
      reason: state.readiness === "not_applicable" ? "manifest says notApplicable" : state.note,
    })),
    { tool: "get_disclosure_artifact", action: scenario.listing.profile === "operating_company" ? "call" : "skip", reason: "verify selected material claims only" },
    { tool: "get_portfolio_overlay", action: overlayRequested ? "call" : "skip", reason: overlayRequested ? "explicit private overlay request" : "not requested" },
  ];

  return {
    scenario,
    datasets,
    calls,
    reportStatus: "complete",
    conclusions,
    finalRecommendation,
    portfolioConclusion,
    rollout: rolloutByPhase[rolloutPhase],
    invariants: [
      "Existing Fastify API, /mcp endpoint, stores, calendars, and ledger are reused additively",
      "Official publisher facts outrank fallbacks; conflicts are preserved and never averaged",
      "MCP retrieves canonical evidence; the Skill owns cross-dataset judgment",
      "One immutable Listing, effectiveAt, knowledgeAt, and policy set bind the whole run",
      "Withheld is explicit; it is never disguised as Hold, neutral, zero, or missing output",
      "Portfolio data is private, optional, post-research, and cannot create a transaction",
    ],
  };
}

export const ROLLOUT_PHASES: readonly RolloutPhase[] = ["dark", "canary", "preview", "ga"];
