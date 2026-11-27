"use client";

import { type ReactNode, useEffect, useState } from "react";

import { usePathname } from "next/navigation";

import { X } from "lucide-react";

import { DocsLink, HelpButton } from "@/components/docs/help-drawer";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { WalkthroughLauncher } from "@/components/walkthrough/walkthrough";
import { useCurrentUser } from "@/hooks/use-current-user";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";
import { cn } from "@/lib/utils";

import { AccountSwitcher } from "./sidebar/account-switcher";
import { LayoutControls } from "./sidebar/layout-controls";
import { SearchDialog } from "./sidebar/search-dialog";
import { ThemeSwitcher } from "./sidebar/theme-switcher";

// Task detail pages stay as-is: they bring their own header/Tabs and padding, so no extra global header or padding is stacked here.
function isFullBleed(pathname: string) {
  const p = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  })();
  // Static export enables trailingSlash, so the list page's own pathname is "/function/tasks/",
  // strip the trailing slash before the prefix test, or the list page would be mistaken for a detail page and lose the global header.
  const normalized = p.replace(/\/+$/, "");
  return normalized.startsWith("/function/tasks/");
}

const RELEASES_URL = "https://github.com/BaaRai/ARTEX/releases";
const UPDATE_DISMISSED_KEY = "artex-update-dismissed";

export function MainContent({ children }: { children: ReactNode }) {
  const currentUser = useCurrentUser();
  const pathname = usePathname();
  const [version, setVersion] = useState("");
  // Only set when the backend has the opt-in update check on (ARTEX_UPDATE_CHECK) and found a newer release.
  const [latest, setLatest] = useState("");
  // Set when the server started with agent isolation degraded (server/isolation.go): the self-test failure.
  const [degraded, setDegraded] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => {
        setVersion((h.version ?? "").replace(/^v(?=\d)/, ""));
        const l = h.latest_version ?? "";
        setLatest(l && getLocalStorageValue(UPDATE_DISMISSED_KEY) !== l ? l : "");
        setDegraded(h.isolation?.mode === "degraded" ? (h.isolation.reason ?? "") : null);
      })
      .catch(() => setVersion(""));
  }, []);

  // Not dismissible: it stays as long as the server runs without agent isolation.
  const isolationBanner =
    degraded !== null ? (
      <div
        role="alert"
        title={degraded}
        className="flex shrink-0 items-center justify-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-1 text-destructive text-xs"
      >
        {t(
          "Agent isolation is degraded: agent shells, tools and file tools run with the server's identity and may read its keys, config and database credentials.",
        )}
      </div>
    ) : null;

  const updateBanner = latest ? (
    <div role="status" className="flex shrink-0 items-center justify-center gap-2 border-b bg-muted/50 px-4 py-1 text-xs">
      <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        {t("ARTEX {version} is available. See the release notes.", { version: latest })}
      </a>
      <button
        type="button"
        aria-label={t("Dismiss update notice")}
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          setLocalStorageValue(UPDATE_DISMISSED_KEY, latest);
          setLatest("");
        }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  ) : null;

  if (isFullBleed(pathname)) {
    return (
      <>
        {isolationBanner}
        {updateBanner}
        {children}
      </>
    );
  }

  return (
    <>
      {isolationBanner}
      {updateBanner}
      <header
        className={cn(
          "flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12",
          "[html[data-navbar-style=sticky]_&]:sticky [html[data-navbar-style=sticky]_&]:top-0 [html[data-navbar-style=sticky]_&]:z-50 [html[data-navbar-style=sticky]_&]:overflow-hidden [html[data-navbar-style=sticky]_&]:rounded-t-[inherit] [html[data-navbar-style=sticky]_&]:bg-background/50 [html[data-navbar-style=sticky]_&]:backdrop-blur-md",
        )}
      >
        <div className="flex w-full items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-1 lg:gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mx-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
            />
            <SearchDialog />
          </div>
          <div className="flex items-center gap-2">
            {version && (
              <span className="hidden font-medium text-muted-foreground text-xs tabular-nums sm:inline">
                {t("Version · {version}", { version })}
              </span>
            )}
            {/* On phones the Docs entry lives in the sidebar ("Learn ARTEX") to keep the header on one line. */}
            <DocsLink className="hidden sm:inline-flex" />
            <HelpButton />
            <WalkthroughLauncher />
            <LayoutControls />
            <ThemeSwitcher />
            <AccountSwitcher users={[currentUser]} />
          </div>
        </div>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden p-4 has-data-[content-padding=false]:p-0 md:p-6 md:has-data-[content-padding=false]:p-0 2xl:px-8 2xl:has-data-[content-padding=false]:p-0">
        {children}
      </div>
    </>
  );
}
