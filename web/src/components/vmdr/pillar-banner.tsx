"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ChevronRight } from "lucide-react";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { flowStepForPillar, pillarForPath, VMDR_FLOW } from "@/lib/vmdr/pillars";

/**
 * One-line strip above every VMDR screen: which pillar you are in, the single question it
 * answers, and where this screen sits in the Scope & Discover → Check Coverage → Inspect
 * Exposure → Mitigate, Remediate & Verify loop (each step links to its screen).
 * Renders nothing on operations, system and learn screens.
 */
export function PillarBanner() {
  const pathname = usePathname();
  const pillar = pillarForPath(pathname);
  if (!pillar) return null;
  const current = flowStepForPillar(pillar.id)?.n;

  return (
    <nav
      aria-label={t("VMDR workflow")}
      data-tour="pillar-banner"
      className="mb-4 flex flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2 xl:flex-row xl:items-center xl:justify-between xl:gap-4"
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-semibold text-primary text-xs">
          {t(pillar.title)}
        </span>
        <span className="truncate text-muted-foreground text-sm">{t(pillar.question)}</span>
      </div>
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {VMDR_FLOW.map((s, i) => (
          <li key={s.n} className="flex items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden className="size-3 text-muted-foreground/60" />}
            <Link
              prefetch={false}
              href={s.href}
              aria-current={s.n === current ? "step" : undefined}
              className={cn(
                "flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground",
                s.n === current ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full text-[10px] tabular-nums",
                  s.n === current ? "bg-primary text-primary-foreground" : "bg-muted-foreground/15",
                )}
              >
                {s.n}
              </span>
              {t(s.title)}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
