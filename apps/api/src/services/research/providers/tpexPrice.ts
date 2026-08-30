import { z } from "zod";

export interface OfficialTpexPriceRow {
  ticker: string;
  sessionDate: string;
  state: "full_bar" | "close_only" | "no_trade";
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  tradedValue?: string;
  tradeCount?: string;
  note?: string;
}

const tpexPriceRowSchema = z.object({}).passthrough();
const tpexSuspensionRowSchema = z.object({}).passthrough();

function rocDateToIso(value: string): string {
  const compact = value.trim().replaceAll("/", "");
  const year = Number(compact.slice(0, 3)) + 1911;
  return `${String(year).padStart(4, "0")}-${compact.slice(3, 5)}-${compact.slice(5, 7)}`;
}

function maybeRocDateToIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d{3}\/?\d{2}\/?\d{2}$/.test(trimmed)) return undefined;
  return rocDateToIso(trimmed);
}

function firstValue(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function normalizedNumeric(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === "--" || trimmed === "---" || trimmed === "----") return undefined;
  return trimmed.replaceAll(",", "");
}

function yesLike(value: string | undefined): boolean {
  if (!value) return false;
  return ["y", "yes", "true", "1", "是"].includes(value.trim().toLowerCase());
}

function stateForRow(values: {
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  tradedValue?: string;
  tradeCount?: string;
}): "full_bar" | "close_only" | "no_trade" {
  const hasOhlc = Boolean(values.open && values.high && values.low && values.close);
  const volume = Number(values.volume ?? "NaN");
  const tradedValue = Number(values.tradedValue ?? "NaN");
  const tradeCount = Number(values.tradeCount ?? "NaN");
  if (hasOhlc && Number.isFinite(volume) && Number.isFinite(tradedValue) && Number.isFinite(tradeCount)) {
    return volume === 0 && tradedValue === 0 && tradeCount === 0 ? "no_trade" : "full_bar";
  }
  return values.close ? "close_only" : "no_trade";
}

export function parseTpexPriceSnapshot(rows: unknown): OfficialTpexPriceRow[] {
  return z.array(tpexPriceRowSchema).parse(rows).flatMap((item) => {
    const row = item as Record<string, unknown>;
    const ticker = firstValue(row, ["SecuritiesCompanyCode", "股票代號"]);
    const rawDate = firstValue(row, ["Date", "資料日期"]);
    if (!ticker || !rawDate) return [];
    const open = firstValue(row, ["Open", "開盤價"]);
    const high = firstValue(row, ["High", "最高價"]);
    const low = firstValue(row, ["Low", "最低價"]);
    const close = firstValue(row, ["Close", "收盤價"]);
    const volume = firstValue(row, ["TradingShares", "成交股數"]);
    const tradedValue = firstValue(row, ["TransactionAmount", "成交金額"]);
    const tradeCount = firstValue(row, ["TransactionNumber", "成交筆數"]);
    return [{
      ticker,
      sessionDate: rocDateToIso(rawDate),
      state: stateForRow({
        open: normalizedNumeric(open),
        high: normalizedNumeric(high),
        low: normalizedNumeric(low),
        close: normalizedNumeric(close),
        volume: normalizedNumeric(volume),
        tradedValue: normalizedNumeric(tradedValue),
        tradeCount: normalizedNumeric(tradeCount),
      }),
      open,
      high,
      low,
      close,
      volume,
      tradedValue,
      tradeCount,
    }];
  });
}

export function parseTpexSuspensionSnapshot(rows: unknown, sessionDate: string): Set<string> {
  const latestEventByCode = new Map<string, { type: "halt" | "resume"; date: string; order: number }>();
  z.array(tpexSuspensionRowSchema).parse(rows).forEach((item, index) => {
    const row = item as Record<string, unknown>;
    const code = firstValue(row, ["SecuritiesCompanyCode", "股票代號", "股票代碼"]);
    if (!code) return;
    const haltedAt = maybeRocDateToIso(firstValue(row, ["DateOfSuspendedTrading", "暫停交易"]));
    const resumedAt = maybeRocDateToIso(firstValue(row, ["DateOfResumedTrading", "恢復交易"]));
    const explicitlyHalted = yesLike(firstValue(row, ["暫停交易"]));
    const explicitlyResumed = yesLike(firstValue(row, ["恢復交易"]));
    const candidate = resumedAt
      ? { type: "resume" as const, date: resumedAt, order: index }
      : haltedAt
        ? { type: "halt" as const, date: haltedAt, order: index }
        : explicitlyResumed
          ? { type: "resume" as const, date: sessionDate, order: index }
          : explicitlyHalted
            ? { type: "halt" as const, date: sessionDate, order: index }
            : null;
    if (!candidate || candidate.date > sessionDate) return;
    const existing = latestEventByCode.get(code);
    if (!existing || candidate.date > existing.date || (candidate.date === existing.date && candidate.order > existing.order)) {
      latestEventByCode.set(code, candidate);
    }
  });
  return new Set(
    [...latestEventByCode.entries()]
      .filter(([, event]) => event.type === "halt")
      .map(([code]) => code),
  );
}
