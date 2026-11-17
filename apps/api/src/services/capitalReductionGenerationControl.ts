/** Test-helper dependency fault. Only the guarded memory/dev-bypass route can arm it. */
const failures = new Set<string>();
const key = (ownerId: string, actionId: string) => JSON.stringify([ownerId, actionId]);
export function armCapitalReductionGenerationFailure(ownerId: string, actionId: string): void { failures.add(key(ownerId,actionId)); }
export function consumeCapitalReductionGenerationFailure(ownerId: string, actionId: string): boolean {
  const selected = key(ownerId,actionId);
  if (!failures.has(selected)) return false;
  failures.delete(selected);
  return true;
}
