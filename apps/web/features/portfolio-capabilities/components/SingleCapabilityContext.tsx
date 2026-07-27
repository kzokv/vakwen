import type { ReactNode } from "react";

interface SingleCapabilityContextProps {
  label: string;
  value: string;
  description?: ReactNode;
  testId: string;
}

export function SingleCapabilityContext({
  label,
  value,
  description = null,
  testId,
}: SingleCapabilityContextProps) {
  return (
    <section
      className="rounded-xl border border-border/80 bg-muted/20 px-4 py-3"
      data-testid={testId}
      aria-live="polite"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
      {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
    </section>
  );
}
