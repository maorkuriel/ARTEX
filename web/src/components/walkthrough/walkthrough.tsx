"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { ChevronLeft, ChevronRight, Compass, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useWalkthrough } from "@/lib/walkthrough/store";
import { PERSONA_LABELS, type Persona, STEPS, stepNumber, stepUseCase, USE_CASES } from "@/lib/walkthrough/usecases";

const STORAGE_KEY = "artex-walkthrough";

// ── Launcher (top header) ────────────────────────────────────────────────────
export function WalkthroughLauncher({ className }: { className?: string }) {
  const start = useWalkthrough((s) => s.start);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-1.5", className)}
      onClick={() => start(0)}
      data-tour="walkthrough-launcher"
    >
      <Compass className="size-3.5" />
      <span className="hidden sm:inline">{t("Guided Walkthrough")}</span>
    </Button>
  );
}

// ── Persona segmented toggle ─────────────────────────────────────────────────
function PersonaToggle({ persona, onChange }: { persona: Persona; onChange: (p: Persona) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border bg-muted/60 p-0.5 text-xs">
      {(["executive", "analyst"] as Persona[]).map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={persona === p}
          onClick={() => onChange(p)}
          className={cn(
            "rounded-md px-2 py-1 font-medium transition-colors",
            persona === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {PERSONA_LABELS[p].long}
        </button>
      ))}
    </div>
  );
}

function Section({ label, children, accent }: { label: string; children: string; accent?: boolean }) {
  return (
    <section className={cn(accent && "rounded-lg border border-primary/20 bg-primary/5 p-2.5")}>
      <p
        className={cn(
          "font-medium text-[11px] uppercase tracking-wide",
          accent ? "text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p className="mt-0.5 text-sm leading-snug">{children}</p>
    </section>
  );
}

// ── Controller + spotlight overlay + guide card ──────────────────────────────
export function Walkthrough() {
  const { active, index, persona, stop, next, prev, goToUseCase, setPersona, reset, hydrate } = useWalkthrough();
  const router = useRouter();
  const [mounted, setMounted] = React.useState(false);
  const [rect, setRect] = React.useState<DOMRect | null>(null);

  const step = STEPS[index];
  const content = step?.[persona];
  const useCase = stepUseCase(index);
  const useCaseTitle = USE_CASES.find((u) => u.id === useCase)?.title ?? "";
  const { x: stepX, y: stepY } = stepNumber(index);

  // Mount + hydrate from localStorage; honor a shareable deep link
  // (?tour=1&persona=analyst&step=3). Never auto-opens from storage alone.
  React.useEffect(() => {
    setMounted(true);
    const patch: Partial<{ active: boolean; index: number; persona: Persona }> = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { persona?: Persona; index?: number };
        if (saved.persona === "executive" || saved.persona === "analyst") patch.persona = saved.persona;
        if (typeof saved.index === "number") patch.index = saved.index;
      }
    } catch {
      /* ignore */
    }
    try {
      const sp = new URLSearchParams(window.location.search);
      const urlPersona = sp.get("persona");
      if (urlPersona === "executive" || urlPersona === "analyst") patch.persona = urlPersona;
      const stepParam = sp.get("step");
      if (stepParam) {
        const n = Number.parseInt(stepParam, 10);
        if (!Number.isNaN(n)) patch.index = n - 1;
      }
      if (sp.get("tour") === "1") patch.active = true;
    } catch {
      /* ignore */
    }
    if (Object.keys(patch).length) hydrate(patch);
  }, [hydrate]);

  // Persist persona + progress.
  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ persona, index }));
    } catch {
      /* ignore */
    }
  }, [persona, index]);

  // Navigate on start and whenever the step changes. Persona is intentionally not a
  // dependency, so toggling it updates the card in place without navigating.
  React.useEffect(() => {
    if (!active || !step) return;
    router.push(step.path);
  }, [active, step, router]);

  // Locate + spotlight the step's anchor once the route has rendered (optionally
  // clicking an element first, e.g. to open a drawer).
  React.useEffect(() => {
    if (!active || !step) return;
    let cancelled = false;
    let raf = 0;
    let tries = 0;
    let settle = 0;
    setRect(null);
    const find = () => {
      if (cancelled) return;
      if (step.autoClick) {
        const toClick = document.querySelector<HTMLElement>(step.autoClick);
        toClick?.click();
      }
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (el) {
        // Tall anchors (a whole tab/table) align to the top so the first rows, which the
        // card usually talks about, are in view; short anchors are centered.
        const tall = el.getBoundingClientRect().height > window.innerHeight * 0.6;
        el.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest", behavior: "smooth" });
        settle = window.setTimeout(() => {
          if (!cancelled) setRect(el.getBoundingClientRect());
        }, 320);
        return;
      }
      tries += 1;
      if (tries < 180) raf = requestAnimationFrame(find);
    };
    const kick = window.setTimeout(find, 140);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(kick);
      window.clearTimeout(settle);
    };
  }, [active, step]);

  // Keep the spotlight aligned while scrolling/resizing.
  React.useEffect(() => {
    if (!active || !step || !rect) return;
    const update = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [active, step, rect]);

  // Esc exits the tour.
  React.useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stop]);

  if (!mounted || !active || !step || !content) return null;

  const isLast = index === STEPS.length - 1;
  const pad = 8;
  // When the spotlight sits on the right half of the screen (e.g. the node inspector
  // drawer), move the card to the left so it does not cover the highlighted panel.
  const cardOnLeft = rect ? rect.left + rect.width / 2 > window.innerWidth / 2 : false;

  return (
    <>
      {/* Spotlight overlay (pointer-events-none so the real UI stays clickable). */}
      <div className="pointer-events-none fixed inset-0 z-[90]" aria-hidden>
        {rect ? (
          <div
            className="absolute rounded-lg ring-2 ring-primary ring-offset-2 transition-all duration-300"
            style={{
              top: Math.max(0, rect.top - pad),
              left: Math.max(0, rect.left - pad),
              width: rect.width + pad * 2,
              height: rect.height + pad * 2,
              boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.55)",
            }}
          />
        ) : (
          <div className="absolute inset-0 bg-slate-950/45" />
        )}
      </div>

      {/* Guide card */}
      <div
        role="dialog"
        aria-label={t("Guided Walkthrough")}
        className={cn(
          "pointer-events-auto fixed z-[95] flex max-h-[85vh] flex-col gap-3 overflow-y-auto rounded-xl border bg-background p-4 shadow-2xl",
          "right-4 bottom-4 left-4 w-auto sm:w-[400px] sm:max-w-[calc(100vw-2rem)]",
          // Flip to the opposite side of the spotlight so a right-side drawer stays visible.
          cardOnLeft ? "sm:right-auto sm:left-4" : "sm:left-auto sm:right-4",
        )}
      >
        {/* Header: use-case switcher + persona + exit */}
        <div className="flex items-center justify-between gap-2">
          <select
            aria-label={t("Use case")}
            className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1 font-medium text-xs"
            value={useCase}
            onChange={(e) => goToUseCase(Number(e.target.value))}
          >
            {USE_CASES.map((u) => (
              <option key={u.id} value={u.id} disabled={!u.available}>
                {t("Use Case {n}", { n: String(u.id) })} · {u.title}
                {u.available ? "" : ` (${t("soon")})`}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={t("Exit tour")}
            onClick={stop}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {t("Step {x} of {y}", { x: String(stepX), y: String(stepY) })}
          </span>
          <PersonaToggle persona={persona} onChange={setPersona} />
        </div>

        <h2 className="font-semibold text-sm leading-tight">{step.headline}</h2>

        {/* Four plain-English, labeled sections */}
        <div className="flex flex-col gap-2.5">
          <Section label={t("The Pain Point")}>{content.painPoint}</Section>
          <Section label={t("What you're looking at")}>{content.lookingAt}</Section>
          <section>
            <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {t("How ARTEX helps")}
            </p>
            <p className="mt-0.5 text-sm leading-snug">{content.howArtex}</p>
            <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5">
              <p className="font-medium text-[11px] text-primary uppercase tracking-wide">{t("Try this")}</p>
              <p className="mt-0.5 text-sm leading-snug">{content.tryThis}</p>
            </div>
          </section>
          <Section label={t("Value Shipped")}>{content.valueShipped}</Section>
        </div>

        {/* Footer: Back / dots / Reset Demo / Next */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <Button type="button" variant="ghost" size="sm" className="gap-1" disabled={index === 0} onClick={prev}>
            <ChevronLeft className="size-4" />
            {t("Back")}
          </Button>
          <div className="flex items-center gap-1" aria-hidden>
            {STEPS.filter((s) => s.useCase === useCase).map((s, i) => (
              <span
                key={s.id}
                className={cn("size-1.5 rounded-full", i === stepX - 1 ? "w-4 bg-primary" : "bg-muted-foreground/30")}
              />
            ))}
          </div>
          <Button type="button" size="sm" className="gap-1" onClick={next}>
            {isLast ? t("Finish") : t("Next")}
            {!isLast && <ChevronRight className="size-4" />}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-2 text-muted-foreground text-xs">
          <span className="truncate">{useCaseTitle}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
              title={t("Restart the walkthrough from Use Case 1, Step 1 (keeps the selected persona)")}
            >
              <RotateCcw className="size-3" />
              {t("Reset Demo")}
            </button>
            <button
              type="button"
              onClick={stop}
              className="rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
            >
              {t("Exit Tour")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
