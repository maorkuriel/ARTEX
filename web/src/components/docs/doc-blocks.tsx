"use client";

import Link from "next/link";

import { ArrowRight, Check, Lightbulb, PlayCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { DocArticle, DocBlock, OutcomeCard } from "@/lib/docs/content";
import { cn } from "@/lib/utils";
import { useWalkthrough } from "@/lib/walkthrough/store";
import type { Persona } from "@/lib/walkthrough/usecases";

/** Launches the Guided Walkthrough at a use case (optionally in a given persona). */
export function WalkthroughButton({
  useCase,
  persona,
  label,
  onLaunch,
  size = "sm",
  variant = "outline",
  className,
}: {
  useCase: number;
  persona?: Persona;
  label?: string;
  onLaunch?: () => void;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
  className?: string;
}) {
  const goToUseCase = useWalkthrough((s) => s.goToUseCase);
  const setPersona = useWalkthrough((s) => s.setPersona);
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={cn("gap-1.5", className)}
      onClick={() => {
        onLaunch?.();
        if (persona) setPersona(persona);
        goToUseCase(useCase);
      }}
    >
      <PlayCircle className="size-3.5" />
      {label ?? t("See it live in walkthrough")}
    </Button>
  );
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case "p":
      return <p className="text-sm leading-relaxed">{block.text}</p>;
    case "list":
      return (
        <ul className="flex flex-col gap-1.5">
          {block.items.map((item) => (
            <li key={item} className="flex gap-2 text-sm leading-relaxed">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="flex flex-col gap-1.5">
          {block.items.map((item, i) => (
            <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-xs tabular-nums">
                {i + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      );
    case "example":
      return (
        <div className="flex gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="font-medium text-[12px] text-primary uppercase tracking-wide">{t("Example")}</p>
            <p className="mt-0.5 text-sm leading-relaxed">{block.text}</p>
          </div>
        </div>
      );
    case "compare":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="font-semibold text-sm">{block.left.title}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {block.left.items.map((item) => (
                <li key={item} className="flex gap-2 text-muted-foreground text-sm leading-relaxed">
                  <X className="mt-0.5 size-4 shrink-0 text-destructive/70" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="font-semibold text-sm">{block.right.title}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {block.right.items.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-relaxed">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
  }
}

/** The body of a guide: its blocks, live-screen links and (optionally) a walkthrough button. */
export function ArticleBody({
  article,
  onNavigate,
  showWalkthrough = true,
}: {
  article: DocArticle;
  onNavigate?: () => void;
  showWalkthrough?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {article.blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static content, order never changes
        <Block key={i} block={b} />
      ))}
      {(article.links?.length || (showWalkthrough && article.useCase)) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {showWalkthrough && article.useCase ? (
            <WalkthroughButton useCase={article.useCase} onLaunch={onNavigate} />
          ) : null}
          {article.links?.map((l) => (
            <Button key={l.href + l.label} asChild size="sm" variant="ghost" className="gap-1">
              <Link href={l.href} onClick={onNavigate}>
                {t("Open {screen}", { screen: l.label })}
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Problem → How ARTEX helps → Outcome card for one VMDR use case. */
export function OutcomeCardView({ card, onLaunch }: { card: OutcomeCard; onLaunch?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground text-xs tabular-nums">
          {card.useCase}
        </span>
        <h3 className="font-semibold text-sm leading-tight">{card.title}</h3>
      </div>
      <dl className="flex flex-1 flex-col gap-2.5">
        <div>
          <dt className="font-medium text-[12px] text-muted-foreground uppercase tracking-wide">{t("Problem")}</dt>
          <dd className="mt-0.5 text-sm leading-snug">{card.problem}</dd>
        </div>
        <div>
          <dt className="font-medium text-[12px] text-muted-foreground uppercase tracking-wide">
            {t("How ARTEX helps")}
          </dt>
          <dd className="mt-0.5 text-sm leading-snug">{card.helps}</dd>
        </div>
        <div>
          <dt className="font-medium text-[12px] text-primary uppercase tracking-wide">{t("Outcome")}</dt>
          <dd className="mt-0.5 font-medium text-sm leading-snug">{card.outcome}</dd>
        </div>
      </dl>
      <WalkthroughButton useCase={card.useCase} onLaunch={onLaunch} className="self-start" />
    </div>
  );
}
