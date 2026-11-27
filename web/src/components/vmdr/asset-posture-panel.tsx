"use client";

import * as React from "react";

import Link from "next/link";

import { ArrowRight, Check, Loader2, Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type { AssetEnvironment, AssetPostureDetail, BusinessCriticality, ValidationMode } from "@/lib/types";

import {
  CRITICALITY_META,
  CriticalityBadge,
  PostureScore,
  PostureStatusBadge,
  VALIDATION_MODE_LABEL,
} from "./posture-badges";

const UNSET = "__unset__";

/**
 * Asset posture drawer section: rolled-up posture, business context (editable inline),
 * validation policy, blast radius, linked findings and recommended next steps.
 * Saving business context recomputes the hierarchy rollup on the server.
 */
export function AssetPosturePanel({ assetId, onChanged }: { assetId: number; onChanged?: () => void }) {
  const [det, setDet] = React.useState<AssetPostureDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<{ tier: BusinessCriticality; owner: string; env: string; mode: string }>({
    tier: "tier_2_business",
    owner: "",
    env: UNSET,
    mode: UNSET,
  });

  const load = React.useCallback(() => {
    setError(null);
    api
      .assetPosture(assetId)
      .then((d) => {
        setDet(d);
        setForm({
          tier: d.asset.business_criticality,
          owner: d.asset.owner_team,
          env: d.asset.environment || UNSET,
          mode: d.validation_mode || UNSET,
        });
      })
      .catch((e: Error) => setError(e.message));
  }, [assetId]);

  React.useEffect(() => {
    setDet(null);
    setEditing(false);
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const d = await api.updateAssetMetadata(assetId, {
        business_criticality: form.tier,
        owner_team: form.owner,
        environment: form.env === UNSET ? "" : (form.env as AssetEnvironment),
        validation_mode: form.mode === UNSET ? "" : (form.mode as ValidationMode),
      });
      setDet(d);
      setEditing(false);
      toast.success(t("Posture recalculated: {score}/100", { score: String(d.asset.posture_score) }));
      onChanged?.();
    } catch (e) {
      toast.error(t("Update failed: {error}", { error: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p className="text-destructive text-xs">{error}</p>;
  if (!det) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {t("Loading…")}
      </div>
    );
  }
  const a = det.asset;
  const open = det.findings.filter((f) => ["confirmed", "in_progress"].includes(f.status));

  return (
    <section data-tour="asset-posture" className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium text-[12px] text-muted-foreground uppercase tracking-wide">
          <ShieldCheck className="size-3.5 text-primary" />
          {t("Asset posture")}
        </p>
        {!editing && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="size-3" />
            {t("Edit context")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PostureStatusBadge status={a.posture_status} />
        <span className="text-sm">
          <PostureScore score={a.posture_score} className="text-lg" />
          <span className="text-muted-foreground text-xs">/100</span>
        </span>
        <CriticalityBadge tier={a.business_criticality} full />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{t("Validation coverage (this asset and below)")}</span>
          <span className="tabular-nums">{Math.round(a.validation_coverage_pct)}%</span>
        </div>
        <Progress value={a.validation_coverage_pct} className="h-1.5" />
        <span className="text-[11px] text-muted-foreground">
          {det.last_validated_at
            ? t("Last validated {when}", { when: new Date(det.last_validated_at).toLocaleString() })
            : t("Never validated — no exploration anchors yet")}
        </span>
      </div>

      {editing ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 flex flex-col gap-1 text-xs">
            <span>{t("Business criticality")}</span>
            <Select value={form.tier} onValueChange={(v) => setForm((f) => ({ ...f, tier: v as BusinessCriticality }))}>
              <SelectTrigger size="sm" className="w-full" aria-label={t("Edit")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CRITICALITY_META) as BusinessCriticality[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(CRITICALITY_META[k].label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex flex-col gap-1 text-xs">
            <span>{t("Owner team")}</span>
            <Input
              value={form.owner}
              maxLength={120}
              aria-label={t("Owner team")}
              onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
              className="h-8 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1 text-xs">
            <span>{t("Environment")}</span>
            <Select value={form.env} onValueChange={(v) => setForm((f) => ({ ...f, env: v }))}>
              <SelectTrigger size="sm" className="w-full" aria-label={t("Edit")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>{t("Not declared")}</SelectItem>
                <SelectItem value="production">{t("Production")}</SelectItem>
                <SelectItem value="staging">{t("Staging")}</SelectItem>
                <SelectItem value="development">{t("Development")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 text-xs">
            <span>{t("Validation mode")}</span>
            <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}>
              <SelectTrigger size="sm" className="w-full" aria-label={t("Edit")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>{t("Derived")}</SelectItem>
                <SelectItem value="read_only_validation">{t("Read-only validation")}</SelectItem>
                <SelectItem value="controlled_active_validation">{t("Controlled active validation")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              {t("Cancel")}
            </Button>
            <Button size="sm" className="gap-1" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {t("Save & recalculate")}
            </Button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">{t("Owner team")}</dt>
          <dd className="font-medium">{a.owner_team}</dd>
          <dt className="text-muted-foreground">{t("Environment")}</dt>
          <dd>
            {a.environment ? t(a.environment.charAt(0).toUpperCase() + a.environment.slice(1)) : t("Not declared")}
          </dd>
          <dt className="text-muted-foreground">{t("Validation policy")}</dt>
          <dd>
            {t(VALIDATION_MODE_LABEL[det.effective_validation_mode] ?? det.effective_validation_mode)}
            {!det.validation_mode && det.effective_validation_mode && (
              <span className="text-muted-foreground"> · {t("derived")}</span>
            )}
          </dd>
          <dt className="text-muted-foreground">{t("Blast radius")}</dt>
          <dd>
            {t("{n} downstream assets · {u} untested", {
              n: String(det.downstream_total),
              u: String(det.downstream_untested),
            })}
          </dd>
          <dt className="text-muted-foreground">{t("Coverage anchors")}</dt>
          <dd className="tabular-nums">{det.anchors}</dd>
        </dl>
      )}

      {open.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-xs">{t("Open exposure")}</p>
          {open.slice(0, 5).map((f) => (
            <Link
              key={f.id}
              prefetch={false}
              href={`/function/findings/detail?id=${f.id}#remediation`}
              className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs hover:bg-muted"
            >
              <span className="truncate">
                <span className="font-medium uppercase">{f.severity}</span> · {f.name || f.vulnclass}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {t("{n} receipts", { n: String(f.evidence_receipts) })} <ArrowRight className="inline size-3" />
              </span>
            </Link>
          ))}
        </div>
      )}

      {det.recommendations.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-xs">{t("Recommended next steps")}</p>
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs leading-snug">
            {det.recommendations.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
