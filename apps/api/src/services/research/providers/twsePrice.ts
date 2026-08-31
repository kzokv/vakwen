import { z } from "zod";

export interface OfficialTwsePriceRow {
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

const twsePriceRowSchema = z.object({}).passthrough();
const twseSuspensionRowSchema = z.object({}).passthrough();

function rocDateToIso(value: string): string {
  const compact = value.trim().replaceAll("/", "");
  const year = Number(compact.slice(0, 3)) + 1911;
  return `${String(year).padStart(4, "0")}-${compact.slice(3, 5)}-${compact.slice(5, 7)}`;
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

export function parseTwsePriceSnapshot(rows: unknown): OfficialTwsePriceRow[] {
  return z.array(twsePriceRowSchema).parse(rows).flatMap((item) => {
    const row = item as Record<string, unknown>;
    const ticker = firstValue(row, ["Code", "證券代號"]);
    const rawDate = firstValue(row, ["Date", "資料日期", "出表日期"]);
    if (!ticker || !rawDate) return [];
    const open = firstValue(row, ["OpeningPrice", "開盤價"]);
    const high = firstValue(row, ["HighestPrice", "最高價"]);
    const low = firstValue(row, ["LowestPrice", "最低價"]);
    const close = firstValue(row, ["ClosingPrice", "收盤價"]);
    const volume = firstValue(row, ["TradeVolume", "成交股數"]);
    const tradedValue = firstValue(row, ["TradeValue", "成交金額"]);
    const tradeCount = firstValue(row, ["Transaction", "成交筆數"]);
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

export function parseTwseSuspensionSnapshot(rows: unknown, sessionDate: string): Set<string> {
  return new Set(
    z.array(twseSuspensionRowSchema).parse(rows)
      .filter((item) => {
        const row = item as Record<string, unknown>;
        const code = firstValue(row, ["Code", "證券代號"]);
        if (!code) return false;
        const haltDate = firstValue(row, ["TradingHaltDate"]);
        const resumptionDate = firstValue(row, ["TradingResumptionDate"]);
        const explicitlyHalted = yesLike(firstValue(row, ["暫停交易"]));
        const explicitlyResumed = yesLike(firstValue(row, ["恢復交易"]));
        if (explicitlyResumed) return false;
        if (resumptionDate && rocDateToIso(resumptionDate) <= sessionDate) return false;
        if (explicitlyHalted) return true;
        if (haltDate) return rocDateToIso(haltDate) <= sessionDate;
        return true;
      })
      .map((item) => firstValue(item as Record<string, unknown>, ["Code", "證券代號"]))
      .filter((value): value is string => value !== undefined),
  );
}
