"use client";

import * as React from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BookOpen, CircleHelp } from "lucide-react";
import { create } from "zustand";

import { ArticleBody, OutcomeCardView } from "@/components/docs/doc-blocks";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { t } from "@/i18n";
import { ARTICLES, articleById, type HelpTopic, helpTopicFor, outcomeFor, PILLARS } from "@/lib/docs/content";
import { cn } from "@/lib/utils";

interface HelpState {
  open: boolean;
  topic: HelpTopic | null;
  show: (topic: HelpTopic) => void;
  setArticle: (articleId: string) => void;
  close: () => void;
}

export const useHelpDrawer = create<HelpState>((set) => ({
  open: false,
  topic: null,
  show: (topic) => set({ open: true, topic }),
  setArticle: (articleId) =>
    set((s) => ({ topic: { articleId, useCase: articleById(articleId)?.useCase, screen: s.topic?.screen ?? "" } })),
  close: () => set({ open: false }),
}));

/** "?" / "How this works" button: opens the drawer on the guide for the current screen. */
export function HelpButton({ className, compact }: { className?: string; compact?: boolean }) {
  const pathname = usePathname();
  const show = useHelpDrawer((s) => s.show);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-1.5", className)}
      aria-label={t("How this works")}
      title={t("How this works: read the guide for this screen")}
      data-tour="help-launcher"
      onClick={() => {
        const tab = new URLSearchParams(window.location.search).get("tab");
        show(helpTopicFor(pathname, tab));
      }}
    >
      <CircleHelp className="size-3.5" />
      <span className={cn("hidden", !compact && "xl:inline")}>{t("How this works")}</span>
    </Button>
  );
}

/** Header link to the /docs knowledge hub. */
export function DocsLink({ className }: { className?: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className={cn("gap-1.5", className)}>
      <Link href="/docs" data-tour="docs-link" aria-label={t("Docs")}>
        <BookOpen className="size-3.5" />
        <span className="hidden md:inline">{t("Docs")}</span>
      </Link>
    </Button>
  );
}

/** Non-modal slide-over: read a guide without losing your place on the current screen. */
export function HelpDrawer() {
  const { open, topic, close, setArticle } = useHelpDrawer();
  const pathname = usePathname();
  const article = topic ? articleById(topic.articleId) : undefined;
  const outcome = outcomeFor(topic?.useCase);

  // Leaving the screen the drawer was opened for closes it (its "for this screen" label would be stale).
  const openedAt = React.useRef(pathname);
  React.useEffect(() => {
    if (open) openedAt.current = pathname;
  }, [open, pathname]);
  React.useEffect(() => {
    if (open && openedAt.current !== pathname) close();
  }, [pathname, open, close]);

  return (
    <Sheet open={open && !!article} onOpenChange={(o) => !o && close()} modal={false}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-md"
        data-tour="help-drawer"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {article && (
          <>
            <SheetHeader className="border-b pr-12">
              <p className="font-medium text-[12px] text-primary uppercase tracking-wide">
                {topic?.screen ? t("How this works · {screen}", { screen: topic.screen }) : t("How this works")}
              </p>
              <SheetTitle className="text-base">{article.title}</SheetTitle>
              <SheetDescription>{article.tagline}</SheetDescription>
              {article.technicalName && (
                <span className="mt-1 self-start rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[12px] text-muted-foreground">
                  {article.technicalName}
                </span>
              )}
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
              <ArticleBody article={article} onNavigate={close} showWalkthrough={!outcome} />
              {outcome && (
                <div className="flex flex-col gap-2">
                  <p className="font-medium text-[12px] text-muted-foreground uppercase tracking-wide">
                    {t("Why it matters for VMDR")}
                  </p>
                  <OutcomeCardView card={outcome} onLaunch={close} />
                </div>
              )}

              <div className="flex flex-col gap-2 border-t pt-4">
                <label
                  htmlFor="help-topic"
                  className="font-medium text-[12px] text-muted-foreground uppercase tracking-wide"
                >
                  {t("Other guides")}
                </label>
                <select
                  id="help-topic"
                  value={article.id}
                  onChange={(e) => setArticle(e.target.value)}
                  className="rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  {PILLARS.filter((p) => ARTICLES.some((a) => a.pillar === p.id)).map((p) => (
                    <optgroup key={p.id} label={p.title}>
                      {ARTICLES.filter((a) => a.pillar === p.id).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t p-3">
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link href={`/docs#${article.id}`} onClick={close}>
                  <BookOpen className="size-3.5" />
                  {t("Open in Docs")}
                </Link>
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={close}>
                {t("Close")}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
