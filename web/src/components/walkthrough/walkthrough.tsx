"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { ChevronLeft, ChevronRight, Compass, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { CHAPTERS, PERSONA_LABELS, type Persona } from "@/lib/walkthrough/chapters";
import { useWalkthrough } from "@/lib/walkthrough/store";

const STORAGE_KEY = "artex-walkthrough";

// ── Launcher (placed in the top header) ──────────────────────────────────────
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
      <span className="hidden sm:inline">{t("Guided tour")}</span>
    </Button>
  );
}

// ── Persona segmented toggle ─────────────────────────────────────────────────
function PersonaToggle({
  persona,
  onChange,
  size = "sm",
}: {
  persona: Persona;
  onChange: (p: Persona) => void;
  size?: "sm" | "xs";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border bg-muted/60 p-0.5",
        size === "xs" ? "text-[11px]" : "text-xs",
      )}
    >
      {(["executive", "analyst"] as Persona[]).map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={persona === p}
          onClick={() => onChange(p)}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition-colors",
            persona === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {PERSONA_LABELS[p].long}
        </button>
      ))}
    </div>
  );
}

// ── Controller + spotlight overlay + guide card ──────────────────────────────
export function Walkthrough() {
  const { active, index, persona, stop, next, prev, goTo, setPersona, restart, hydrate } = useWalkthrough();
  const router = useRouter();
  const [mounted, setMounted] = React.useState(false);
  const [rect, setRect] = React.useState<DOMRect | null>(null);

  const chapter = CHAPTERS[index];
  const content = chapter?.[persona];

  // Mount + hydrate persona/progress from localStorage, and honor a shareable
  // deep link (?tour=1&persona=analyst&chapter=3). Never auto-opens from storage.
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
      /* ignore unreadable storage */
    }
    try {
      const sp = new URLSearchParams(window.location.search);
      const urlPersona = sp.get("persona");
      if (urlPersona === "executive" || urlPersona === "analyst") patch.persona = urlPersona;
      const chapterParam = sp.get("chapter");
      if (chapterParam) {
        const n = Number.parseInt(chapterParam, 10);
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

  // Navigate to the current chapter's route on start and whenever the chapter
  // changes. Persona switches are deliberately NOT a dependency, so toggling
  // persona updates the card in place without navigating or resetting progress.
  React.useEffect(() => {
    if (!active || !chapter) return;
    router.push(chapter.path);
  }, [active, chapter, router]);

  // Locate + spotlight the chapter's anchor once the route has rendered.
  React.useEffect(() => {
    if (!active || !chapter) return;
    let cancelled = false;
    let raf = 0;
    let tries = 0;
    let settle = 0;
    setRect(null);
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${chapter.anchor}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        settle = window.setTimeout(() => {
          if (!cancelled) setRect(el.getBoundingClientRect());
        }, 320);
        return;
      }
      tries += 1;
      if (tries < 180) raf = requestAnimationFrame(find); // ~3s budget while the route loads
    };
    const kick = window.setTimeout(find, 120);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(kick);
      window.clearTimeout(settle);
    };
  }, [active, chapter]);

  // Keep the spotlight aligned while scrolling/resizing on the current chapter.
  React.useEffect(() => {
    if (!active || !chapter || !rect) return;
    const update = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${chapter.anchor}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [active, chapter, rect]);

  // Esc closes the tour.
  React.useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stop]);

  if (!mounted || !active || !chapter || !content) return null;

  const isLast = index === CHAPTERS.length - 1;
  const pad = 8;

  return (
    <>
      {/* Spotlight: a cutout over the anchor (box-shadow dims everything else).
          pointer-events-none keeps the real UI clickable so the guided action works. */}
      <div className="pointer-events-none fixed inset-0 z-[90]" aria-hidden>
        {rect ? (
          <div
            className="absolute rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-transparent transition-all duration-300"
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
        aria-label={t("Guided walkthrough")}
        className={cn(
          "pointer-events-auto fixed z-[95] flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-2xl",
          "right-4 bottom-4 left-4 w-auto sm:left-auto sm:w-[380px] sm:max-w-[calc(100vw-2rem)]",
        )}
      >
        {/* Header: chapter + persona toggle + close */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <Compass className="size-3.5" />
              <span className="font-medium">
                {t("Chapter {n} of {total}", { n: String(index + 1), total: String(CHAPTERS.length) })}
              </span>
            </div>
            <h2 className="mt-0.5 truncate font-semibold text-sm">{chapter.title}</h2>
          </div>
          <button
            type="button"
            aria-label={t("Close")}
            onClick={stop}
            className="-mt-1 -mr-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <PersonaToggle persona={persona} onChange={setPersona} />

        {/* Body: three tailored sections */}
        <div className="flex flex-col gap-2.5">
          <section>
            <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {t("What you're looking at")}
            </p>
            <p className="mt-0.5 font-semibold text-sm">{content.headline}</p>
            <p className="mt-0.5 text-muted-foreground text-sm leading-snug">{content.summary}</p>
          </section>
          <section className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
            <p className="font-medium text-[11px] text-primary uppercase tracking-wide">{t("Try this")}</p>
            <p className="mt-0.5 text-sm leading-snug">{content.action}</p>
          </section>
          <section>
            <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {t("Why it matters")}
            </p>
            <p className="mt-0.5 text-muted-foreground text-sm leading-snug">{content.takeaway}</p>
          </section>
        </div>

        {/* Footer: nav + dots + restart */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Previous")}
              disabled={index === 0}
              onClick={prev}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="flex items-center gap-1" aria-hidden>
              {CHAPTERS.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={t("Go to chapter {n}", { n: String(i + 1) })}
                  className={cn(
                    "size-1.5 rounded-full transition-all",
                    i === index ? "w-4 bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/60",
                  )}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              onClick={restart}
              title={t("Restart the walkthrough from chapter 1 (keeps the selected persona)")}
            >
              <RotateCcw className="size-3.5" />
              {t("Reset")}
            </Button>
            <Button type="button" size="sm" className="gap-1" onClick={next}>
              {isLast ? t("Finish") : t("Next")}
              {!isLast && <ChevronRight className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
