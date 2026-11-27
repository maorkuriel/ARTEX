"use client";

import * as React from "react";

import Link from "next/link";

import { ArrowRight, BookOpen, Compass, Search, X } from "lucide-react";

import { ArticleBody, OutcomeCardView } from "@/components/docs/doc-blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import {
  ARTICLES,
  articleText,
  GLOSSARY,
  OUTCOMES,
  PILLARS,
  type PillarId,
  ROLE_GUIDES,
  type RoleGuide,
} from "@/lib/docs/content";
import { cn } from "@/lib/utils";
import { useWalkthrough } from "@/lib/walkthrough/store";

const includesAll = (haystack: string, q: string) =>
  q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => haystack.includes(w));

/**
 * Keeps the table of contents in view while the page scrolls. CSS `position: sticky`
 * cannot be used here: the app shell's content wrappers set `overflow-x: hidden`, which
 * turns them into (non-scrolling) scroll containers that sticky elements bind to.
 */
function useFollowScroll(columnRef: React.RefObject<HTMLElement | null>, itemRef: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const TOP = 16;
    let raf = 0;
    const update = () => {
      raf = 0;
      const column = columnRef.current;
      const item = itemRef.current;
      if (!column || !item) return;
      const room = column.offsetHeight - item.offsetHeight;
      const offset = Math.max(0, Math.min(room, TOP - column.getBoundingClientRect().top));
      item.style.transform = offset ? `translateY(${offset}px)` : "";
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [columnRef, itemRef]);
}

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    history.replaceState(null, "", `#${id}`);
  } catch {
    /* ignore */
  }
}

const linkClass = "inline-flex items-center gap-1 text-primary text-xs underline-offset-2 hover:underline";

/** The single action under a role-guide step: start the tour, open a screen, or jump to a guide. */
function StepAction({ guide, step }: { guide: RoleGuide; step: RoleGuide["steps"][number] }) {
  const start = useWalkthrough((s) => s.start);
  const setPersona = useWalkthrough((s) => s.setPersona);
  if (step.walkthrough) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs"
        onClick={() => {
          setPersona(guide.id);
          start(0);
        }}
      >
        <Compass className="size-3.5" />
        {guide.id === "executive" ? t("Start Executive walkthrough") : t("Start Analyst walkthrough")}
      </Button>
    );
  }
  if (step.href) {
    return (
      <Link href={step.href} className={linkClass}>
        {t("Open screen")}
        <ArrowRight className="size-3" />
      </Link>
    );
  }
  const articleId = step.articleId;
  if (articleId) {
    return (
      <button type="button" onClick={() => scrollToId(articleId)} className={linkClass}>
        {t("Read the guide")}
        <ArrowRight className="size-3" />
      </button>
    );
  }
  return null;
}

function RoleGuideCard({ guide }: { guide: RoleGuide }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div>
        <p className="font-medium text-[12px] text-primary uppercase tracking-wide">{t("Where to start")}</p>
        <h3 className="mt-0.5 font-semibold text-sm">{guide.title}</h3>
        <p className="mt-0.5 text-muted-foreground text-sm">{guide.who}</p>
      </div>
      <ol className="flex flex-col gap-2">
        {guide.steps.map((s, i) => (
          <li key={s.text} className="flex gap-2.5 text-sm leading-snug">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-xs tabular-nums">
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <span>{s.text}</span>
              <StepAction guide={guide} step={s} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function DocsPage() {
  const [query, setQuery] = React.useState("");
  const [activeSection, setActiveSection] = React.useState<PillarId>("overview");
  const start = useWalkthrough((s) => s.start);
  const q = query.trim();

  const articles = React.useMemo(() => (q ? ARTICLES.filter((a) => includesAll(articleText(a), q)) : ARTICLES), [q]);
  const outcomes = React.useMemo(
    () =>
      q
        ? OUTCOMES.filter((o) => includesAll(`${o.title} ${o.problem} ${o.helps} ${o.outcome}`.toLowerCase(), q))
        : OUTCOMES,
    [q],
  );
  const glossary = React.useMemo(
    () =>
      q
        ? GLOSSARY.filter((g) => includesAll(`${g.term} ${g.definition} ${g.example ?? ""}`.toLowerCase(), q))
        : GLOSSARY,
    [q],
  );
  const roles = React.useMemo(
    () =>
      q
        ? ROLE_GUIDES.filter((r) =>
            includesAll(`${r.title} ${r.who} ${r.steps.map((s) => s.text).join(" ")}`.toLowerCase(), q),
          )
        : ROLE_GUIDES,
    [q],
  );
  const total = articles.length + outcomes.length + glossary.length + roles.length;

  const visible: Record<PillarId, boolean> = {
    overview: articles.some((a) => a.pillar === "overview"),
    "how-it-works": articles.some((a) => a.pillar === "how-it-works"),
    vmdr: outcomes.length > 0,
    glossary: glossary.length > 0 || roles.length > 0,
  };

  // Honor a #section / #article deep link (e.g. from the "How this works" drawer).
  React.useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!id) return;
    const timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 150);
    return () => window.clearTimeout(timer);
  }, []);

  // Track which pillar is on screen for the table of contents.
  React.useEffect(() => {
    const els = PILLARS.map((p) => document.getElementById(p.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveSection(top.target.id as PillarId);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  });

  const tocColumnRef = React.useRef<HTMLElement>(null);
  const tocRef = React.useRef<HTMLElement>(null);
  useFollowScroll(tocColumnRef, tocRef);

  return (
    <div className="mx-auto flex w-full max-w-[1840px] flex-col gap-6" data-tour="docs-hub">
      {/* Hero */}
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-xs md:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BookOpen className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-semibold text-xl tracking-tight">{t("Learn ARTEX")}</h1>
            <p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-relaxed">
              {t(
                "What ARTEX is, how it works under the hood, and how vulnerability management teams benefit, in plain English. Every guide links to the live screen and to the Guided Walkthrough.",
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search the docs, e.g. “proof”, “retest”, “scope”")}
              aria-label={t("Search the docs")}
              className="pl-8"
            />
            {query && (
              <button
                type="button"
                aria-label={t("Clear search")}
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button type="button" className="gap-1.5" onClick={() => start(0)}>
            <Compass className="size-4" />
            {t("Start the Guided Walkthrough")}
          </Button>
        </div>
        {q && (
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {t("{count} results for “{query}”", { count: String(total), query: q })}
          </p>
        )}
      </div>

      {/* Mobile: pillar chips */}
      <nav aria-label={t("On this page")} className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 lg:hidden">
        {PILLARS.filter((p) => visible[p.id]).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => scrollToId(p.id)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs",
              activeSection === p.id
                ? "border-primary bg-primary/10 text-primary"
                : "bg-background text-muted-foreground",
            )}
          >
            {p.number}. {p.title}
          </button>
        ))}
      </nav>

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[240px_minmax(0,1fr)]">
        {/* Table of contents: follows the scroll (see useFollowScroll) */}
        <aside ref={tocColumnRef} className="hidden lg:block">
          <nav ref={tocRef} aria-label={t("On this page")} className="flex flex-col gap-1 will-change-transform">
            <p className="mb-1 px-2 font-medium text-[12px] text-muted-foreground uppercase tracking-wide">
              {t("On this page")}
            </p>
            {PILLARS.map((p) => (
              <div key={p.id} className={cn(!visible[p.id] && "opacity-40")}>
                <button
                  type="button"
                  disabled={!visible[p.id]}
                  onClick={() => scrollToId(p.id)}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left font-medium text-sm",
                    activeSection === p.id ? "bg-primary/10 text-primary" : "hover:bg-muted",
                  )}
                >
                  {p.number}. {p.title}
                </button>
                {p.id !== "vmdr" && p.id !== "glossary" && (
                  <div className="ml-3 flex flex-col border-l pl-2">
                    {articles
                      .filter((a) => a.pillar === p.id)
                      .map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => scrollToId(a.id)}
                          className="truncate rounded px-1.5 py-1 text-left text-muted-foreground text-xs hover:text-foreground"
                        >
                          {a.title}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col gap-10">
          {total === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
              <p className="font-medium text-sm">{t("No guides match “{query}”", { query: q })}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => setQuery("")}>
                {t("Clear search")}
              </Button>
            </div>
          )}

          {/* Pillars 1 and 2: articles */}
          {(["overview", "how-it-works"] as const).map((pid) => {
            const pillar = PILLARS.find((p) => p.id === pid);
            const list = articles.filter((a) => a.pillar === pid);
            if (!pillar || !list.length) return null;
            return (
              <section key={pid} id={pid} className="flex scroll-mt-4 flex-col gap-4">
                <header>
                  <p className="font-medium text-primary text-xs">{t("Part {n}", { n: String(pillar.number) })}</p>
                  <h2 className="font-semibold text-lg tracking-tight">{pillar.title}</h2>
                  <p className="text-muted-foreground text-sm">{pillar.summary}</p>
                </header>
                <div className="grid items-start gap-4 2xl:grid-cols-2">
                  {list.map((a) => (
                    <article
                      key={a.id}
                      id={a.id}
                      className="flex scroll-mt-4 flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs md:p-5"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-base">{a.title}</h3>
                          {a.technicalName && (
                            <span className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[12px] text-muted-foreground">
                              {a.technicalName}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-muted-foreground text-sm">{a.tagline}</p>
                      </div>
                      <ArticleBody article={a} />
                    </article>
                  ))}
                </div>
              </section>
            );
          })}

          {/* Pillar 3: VMDR outcomes */}
          {outcomes.length > 0 && (
            <section id="vmdr" className="flex scroll-mt-4 flex-col gap-4">
              <header>
                <p className="font-medium text-primary text-xs">{t("Part {n}", { n: "3" })}</p>
                <h2 className="font-semibold text-lg tracking-tight">{PILLARS[2].title}</h2>
                <p className="text-muted-foreground text-sm">{PILLARS[2].summary}</p>
              </header>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {outcomes.map((o) => (
                  <div key={o.useCase} id={`use-case-${o.useCase}`} className="scroll-mt-4">
                    <OutcomeCardView card={o} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Pillar 4: glossary + role guides */}
          {(glossary.length > 0 || roles.length > 0) && (
            <section id="glossary" className="flex scroll-mt-4 flex-col gap-4">
              <header>
                <p className="font-medium text-primary text-xs">{t("Part {n}", { n: "4" })}</p>
                <h2 className="font-semibold text-lg tracking-tight">{PILLARS[3].title}</h2>
                <p className="text-muted-foreground text-sm">{PILLARS[3].summary}</p>
              </header>
              {roles.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2">
                  {roles.map((r) => (
                    <RoleGuideCard key={r.id} guide={r} />
                  ))}
                </div>
              )}
              {glossary.length > 0 && (
                <dl className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {glossary.map((g) => (
                    <div key={g.term} className="rounded-xl border bg-card p-4 shadow-xs">
                      <dt className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm">{g.term}</span>
                        {g.articleId && (
                          <button
                            type="button"
                            onClick={() => {
                              setQuery("");
                              window.setTimeout(() => g.articleId && scrollToId(g.articleId), 50);
                            }}
                            className="shrink-0 text-primary text-xs underline-offset-2 hover:underline"
                          >
                            {t("Learn more")}
                          </button>
                        )}
                      </dt>
                      <dd className="mt-1 text-sm leading-snug">{g.definition}</dd>
                      {g.example && (
                        <dd className="mt-2 rounded-md bg-muted px-2 py-1 font-mono text-muted-foreground text-xs">
                          {g.example}
                        </dd>
                      )}
                    </div>
                  ))}
                </dl>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
