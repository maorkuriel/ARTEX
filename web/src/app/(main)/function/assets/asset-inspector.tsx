"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AnchorProvenance } from "@/components/vmdr/anchor-provenance";
import { AssetPosturePanel } from "@/components/vmdr/asset-posture-panel";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type { Asset, Finding } from "@/lib/types";
import { cn } from "@/lib/utils";

// The deterministic deduplication key: the uniqueness tuple ARTEX normalizes each raw
// observation to (mirrors the uq_av2_* unique indexes in db/schema.sql). Re-observations
// that normalize to the same key UPSERT onto the same canonical asset id.
function dedupKey(a: Asset): string {
  switch (a.type) {
    case "root_domain":
      return `root_domain · domain=${a.domain ?? ""}`;
    case "subdomain":
      return `subdomain · domain=${a.domain ?? ""} · record_type=${a.record_type ?? ""}`;
    case "ip":
      return `ip · ${a.ip ?? ""}`;
    case "app":
      return a.bundle_id ? `app · bundle_id=${a.bundle_id}` : `app · app_name=${a.app_name ?? ""}`;
    case "service":
      return a.service_type === "http"
        ? `service · url=${a.url ?? ""}`
        : `service · ${a.domain ?? ""}:${a.ip ?? ""}:${a.port ?? ""}:${a.service_name ?? ""}`;
    case "endpoint":
      return `endpoint · url=${a.url ?? ""} · method=${a.method ?? "GET"}`;
    default:
      return a.type;
  }
}

// The canonical parent→child lineage, reconstructed from the node's own fields.
function lineage(a: Asset): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (a.root_domain) out.push({ label: "root_domain", value: a.root_domain });
  if (a.domain && a.domain !== a.root_domain) out.push({ label: "subdomain", value: a.domain });
  if (a.ip) out.push({ label: "ip", value: a.ip });
  if (a.service_name && a.type !== "endpoint") out.push({ label: "service", value: a.service_name });
  if (a.app_name) out.push({ label: "app", value: a.app_name });
  if (a.url) out.push({ label: a.type, value: a.url });
  else if (out.length === 0) out.push({ label: a.type, value: assetLabel(a) });
  return out;
}

function assetLabel(a: Asset): string {
  // First non-empty identifier; empty strings must fall through, so || (not ??).
  // biome-ignore lint/nursery/useNullishCoalescing: empty-string fall-through is intended here.
  return a.url || a.domain || a.ip || a.app_name || `#${a.id}`;
}

export function AssetInspector({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const [taskNames, setTaskNames] = React.useState<Record<number, string>>({});
  const [findings, setFindings] = React.useState<Finding[]>([]);

  // Resolve contributing task names + findings bound to this canonical node.
  React.useEffect(() => {
    if (!asset) return;
    let live = true;
    api
      .tasks()
      .then(({ tasks }) => {
        if (!live) return;
        const map: Record<number, string> = {};
        for (const tk of tasks) map[Number(tk.id)] = tk.name || tk.description || `Task #${tk.id}`;
        setTaskNames(map);
      })
      .catch(() => {
        /* names are best-effort */
      });
    api
      .findings()
      .then((list) => {
        if (!live) return;
        setFindings(list.filter((f) => (f.assets ?? []).some((x) => Number(x.id) === asset.id)));
      })
      .catch(() => {
        if (live) setFindings([]);
      });
    return () => {
      live = false;
    };
  }, [asset]);

  if (!asset) return null;
  const tasks = asset.task_ids ?? [];
  const chain = lineage(asset);

  return (
    <Sheet open={!!asset} onOpenChange={(o) => !o && onClose()} modal={false}>
      <SheetContent
        side="right"
        data-tour="asset-inspector"
        className="w-[94vw] gap-0 overflow-y-auto p-0 sm:max-w-[440px]"
        // Stay open when interacting with the guided-walkthrough card; close via the ✕.
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="border-b">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[11px] uppercase">
              {asset.type}
            </Badge>
            <span className="text-muted-foreground text-xs">
              {t("Canonical asset #{id}", { id: String(asset.id) })}
            </span>
          </div>
          <SheetTitle className="break-all font-mono text-sm">{assetLabel(asset)}</SheetTitle>
          <SheetDescription className="sr-only">{t("Asset inspector")}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-4">
          <AssetPosturePanel assetId={asset.id} />
          <AnchorProvenance assetId={asset.id} />
          {/* Deduplication key */}
          <section data-tour="asset-dedup-key" className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="font-medium text-[12px] text-primary uppercase tracking-wide">{t("Deduplication key")}</p>
            <code className="mt-1 block break-all rounded bg-background/70 px-2 py-1.5 font-mono text-xs">
              {dedupKey(asset)}
            </code>
            <p className="mt-1.5 text-muted-foreground text-xs">
              {t(
                "Every raw observation is normalized to this uniqueness tuple; re-observations merge onto this one canonical id.",
              )}
            </p>
          </section>

          {/* Parent → child lineage */}
          <section>
            <p className="font-medium text-[12px] text-muted-foreground uppercase tracking-wide">
              {t("Parent → child lineage")}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {chain.map((n, i) => (
                <React.Fragment key={`${n.label}-${n.value}`}>
                  {i > 0 && <span className="text-muted-foreground">→</span>}
                  <span
                    className={cn(
                      "rounded-md border px-1.5 py-0.5 font-mono text-[12px]",
                      i === chain.length - 1 ? "border-primary/30 bg-primary/5" : "bg-muted/40",
                    )}
                    title={n.label}
                  >
                    {n.value}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </section>

          {/* Merged observations + cross-task findings */}
          <section data-tour="asset-provenance">
            <p className="font-medium text-[12px] text-muted-foreground uppercase tracking-wide">
              {t("Merged observations")}
            </p>
            <p className="mt-1 text-sm">{t("Merged from {n} task observations", { n: String(tasks.length) })}</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {tasks.map((id) => (
                <li key={id} className="flex items-center gap-2 text-xs">
                  <span className="inline-block size-1.5 rounded-full bg-primary/60" />
                  <span className="font-mono text-muted-foreground">#{id}</span>
                  <span className="truncate">{taskNames[id] ?? t("Discovery task")}</span>
                </li>
              ))}
              {tasks.length === 0 && (
                <li className="text-muted-foreground text-xs">{t("No task provenance recorded")}</li>
              )}
            </ul>

            <p className="mt-3 font-medium text-[12px] text-muted-foreground uppercase tracking-wide">
              {t("Findings on this canonical node ({n})", { n: String(findings.length) })}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {findings.map((f) => (
                <li key={f.id} className="flex items-start gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 capitalize",
                      f.severity === "critical" && "border-red-300 text-red-600",
                      f.severity === "high" && "border-orange-300 text-orange-600",
                    )}
                  >
                    {f.severity}
                  </Badge>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{f.name || f.vulnclass}</p>
                    {f.task_description && <p className="truncate text-muted-foreground">{f.task_description}</p>}
                  </div>
                </li>
              ))}
              {findings.length === 0 && (
                <li className="text-muted-foreground text-xs">{t("No findings bound to this node yet")}</li>
              )}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
