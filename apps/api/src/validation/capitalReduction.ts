import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}, "Invalid calendar date");
const decimal = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/).max(100);
const text = z.string().trim().min(1).max(2000);
const amount = z.number().finite().nonnegative().refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-7, "Expected at most two decimal places");
export const capitalReductionAnnouncementSchema = z.object({
  eventId: text, version: z.number().int().positive(), ticker: text, marketCode: z.literal("TW"), venue: z.enum(["TWSE", "TPEX"]), instrumentType: z.literal("STOCK"), currency: z.literal("TWD"),
  officialReference: text, sourceUrl: z.string().url().max(2000).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Source URL must use HTTP or HTTPS"), publishedDate: date, reductionDate: date,
  suspensionStartDate: date, suspensionEndDate: date, exchangeRecordDate: date, conversionDate: date, conversionTimestamp: z.string().datetime({ offset: true }).optional(), scheduledPaymentDate: date,
  ratioNumerator: decimal, ratioDenominator: decimal, repaymentPerOldShare: decimal, payoutRounding: z.enum(["FLOOR", "HALF_UP"]), officialReferencePrice: decimal.optional(), fractionReferencePrice: decimal.optional(),
}).strict().superRefine((announcement,ctx) => {
  if (announcement.suspensionStartDate>announcement.suspensionEndDate) ctx.addIssue({code:"custom",path:["suspensionEndDate"],message:"Suspension end precedes start"});
  if (announcement.conversionTimestamp) {
    const instant=new Date(announcement.conversionTimestamp);
    const actualDay=Number.isFinite(instant.getTime()) ? new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(instant) : null;
    if (actualDay!==announcement.conversionDate) ctx.addIssue({code:"custom",path:["conversionTimestamp"],message:"Effective timestamp must match the Taiwan conversion day"});
  }
});
export const capitalReductionInputSchema = z.object({
  operation: z.enum(["POST", "RECONCILE", "AMEND", "VOID", "RESTORE"]), accountId: text, ticker: text,
  announcement: capitalReductionAnnouncementSchema, actionId: text.optional(), expectedRevision: z.number().int().positive().optional(),
  confirmedWholeQuantity: z.number().int().nonnegative().safe(), evidenceReference: text, reason: text,
  repaymentReceipts: z.array(z.object({ id: text, evidenceReference: text, receivedDate: date, grossAmount: amount, cashAmount: amount, feeAmount: amount }).strict()).max(1000),
  fractionAdjustments: z.array(z.object({ id: text, evidenceReference: text, occurredDate: date, processingFeeAmount: amount, feeOffsetAmount: amount, cashAmount: amount, feeCashPaidAmount: amount }).strict()).max(1000).optional(),
  fractionSettlement: z.object({ id: text, evidenceReference: text, receivedDate: date, grossAmount: amount, processingFeeAmount: amount, feeOffsetAmount: amount, cashAmount: amount, feeCashPaidAmount: amount }).strict().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.announcement.ticker !== input.ticker) ctx.addIssue({ code: "custom", path: ["ticker"], message: "Announcement security differs" });
  for (const adjustment of input.fractionAdjustments ?? []) if (!input.fractionSettlement || adjustment.occurredDate < input.fractionSettlement.receivedDate || adjustment.occurredDate < input.announcement.conversionDate) ctx.addIssue({ code: "custom", path: ["fractionAdjustments"], message: "Fraction adjustment requires a prior gross settlement and cannot precede conversion" });
  for (const receipt of [...input.repaymentReceipts, ...(input.fractionSettlement ? [input.fractionSettlement] : [])]) if (receipt.receivedDate < input.announcement.conversionDate) ctx.addIssue({ code: "custom", path: ["repaymentReceipts"], message: "Settlement precedes conversion" });
});
export const capitalReductionConfirmSchema = z.object({ previewId: text, fingerprint: text, confirmationDigest: text, confirmationSummary: z.string().min(1).max(10000), confirmed: z.literal(true) }).strict();

export const capitalReductionAnnouncementInputSchema = z.object({ accountId: text, announcement: capitalReductionAnnouncementSchema, reason: text }).strict();
