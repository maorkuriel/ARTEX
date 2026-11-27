"use client";

import * as React from "react";

import { BanIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type { AssetInterceptKind, AssetInterceptRule } from "@/lib/types";

// ---- kind metadata ----

const KIND_OPTIONS: { value: AssetInterceptKind; label: string; group: string; placeholder: string }[] = [
  { value: "exact_domain", label: t("Domain (exact)"), group: "Exact match", placeholder: "example.gov.cn" },
  { value: "exact_ip", label: t("IP (exact)"), group: "Exact match", placeholder: "203.0.113.10" },
  { value: "exact_url", label: t("URL (exact)"), group: "Exact match", placeholder: "https://example.gov.cn/login" },
  { value: "fuzzy_domain", label: t("Domain (fuzzy)"), group: "Fuzzy match", placeholder: ".gov.cn" },
  { value: "fuzzy_ip", label: t("IP (fuzzy)"), group: "Fuzzy match", placeholder: "203.0.113." },
  { value: "fuzzy_url", label: t("URL (fuzzy)"), group: "Fuzzy match", placeholder: "/admin" },
  { value: "cidr", label: t("CIDR network"), group: "CIDR", placeholder: "192.168.0.0/16" },
];

const KIND_LABEL: Record<AssetInterceptKind, string> = Object.fromEntries(
  KIND_OPTIONS.map((o) => [o.value, o.label]),
) as Record<AssetInterceptKind, string>;

const KIND_GROUPS = ["Exact match", "Fuzzy match", "CIDR"];

function KindBadge({ kind }: { kind: AssetInterceptKind }) {
  const fuzzy = kind.startsWith("fuzzy_");
  const cidr = kind === "cidr";
  return (
    <Badge
      variant="outline"
      className={
        cidr
          ? "border-sky-400 text-sky-600"
          : fuzzy
            ? "border-amber-400 text-amber-600"
            : "border-emerald-400 text-emerald-600"
      }
    >
      {KIND_LABEL[kind]}
    </Badge>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Label>
      {children}
      {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ---- form state ----

type RuleForm = {
  enabled: boolean;
  kind: AssetInterceptKind;
  pattern: string;
  note: string;
};

const defaultForm = (): RuleForm => ({ enabled: true, kind: "fuzzy_domain", pattern: "", note: "" });

// Light frontend validation (matching the backend: only exact_ip / cidr get format checks, the rest is left to the backend).
function frontValidate(form: RuleForm): string | null {
  const p = form.pattern.trim();
  if (!p) return t("Match content cannot be empty");
  if (form.kind === "cidr" && !/^[0-9a-fA-F:.]+\/\d{1,3}$/.test(p)) {
    return t("Invalid CIDR format, e.g. 192.168.0.0/16");
  }
  return null;
}

// ---- rule tester ----

/** Asks the server which enabled rule (if any) would block a domain / IP / URL (same matcher as enforcement). */
function RuleTester() {
  const [target, setTarget] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof api.checkAssetIntercept>> | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const v = target.trim();
    if (!v) return;
    setChecking(true);
    try {
      setResult(await api.checkAssetIntercept(v));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div>
          <p className="font-semibold text-sm">{t("Check a target")}</p>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {t("See whether a domain, IP or URL would be blocked, and by which rule.")}
          </p>
        </div>
        <form onSubmit={check} className="flex gap-2">
          <Input
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setResult(null);
            }}
            placeholder="portal.example.gov / 10.0.0.5 / https://…"
            aria-label={t("Target to check")}
            className="min-w-0"
          />
          <Button type="submit" variant="outline" disabled={checking || !target.trim()} className="shrink-0">
            {checking ? t("Checking…") : t("Check")}
          </Button>
        </form>
        {result && (
          <div
            role="status"
            className={
              result.blocked
                ? "rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
                : "rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"
            }
          >
            {result.blocked && result.rule ? (
              <>
                <p className="font-medium text-destructive">{t("Blocked")}</p>
                <p className="mt-1 text-muted-foreground">
                  {t("Matched {value} via rule", { value: result.matched_value ?? result.target })}{" "}
                  <code className="rounded bg-muted px-1 font-mono">{result.rule.pattern}</code> (
                  {KIND_LABEL[result.rule.kind]})
                </p>
              </>
            ) : (
              <p className="font-medium text-emerald-700 dark:text-emerald-400">
                {t("Not blocked by any enabled rule")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- page ----

export default function AssetInterceptPage() {
  const [rules, setRules] = React.useState<AssetInterceptRule[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AssetInterceptRule | null>(null);
  const [form, setForm] = React.useState<RuleForm>(defaultForm());
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setRules(await api.assetInterceptRules());
    } catch {
      toast.error(t("Failed to load asset interception rules"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  function set(patch: Partial<RuleForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function openNew() {
    setEditing(null);
    setForm(defaultForm());
    setOpen(true);
  }

  function openEdit(rule: AssetInterceptRule) {
    setEditing(rule);
    setForm({ enabled: rule.enabled, kind: rule.kind, pattern: rule.pattern, note: rule.note });
    setOpen(true);
  }

  async function handleSave() {
    const err = frontValidate(form);
    if (err) {
      toast.error(err);
      return;
    }
    const payload = { ...form, pattern: form.pattern.trim() };
    setSaving(true);
    try {
      if (editing) {
        await api.updateAssetInterceptRule(editing.id, payload);
        toast.success(t("Rule updated"));
      } else {
        await api.createAssetInterceptRule(payload);
        toast.success(t("Rule created"));
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(rule: AssetInterceptRule) {
    if (
      !window.confirm(
        t('Are you sure you want to delete asset interception rule "{pattern}"?', { pattern: rule.pattern }),
      )
    )
      return;
    try {
      await api.deleteAssetInterceptRule(rule.id);
      toast.success(t("Rule deleted"));
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleToggle(rule: AssetInterceptRule) {
    try {
      await api.toggleAssetInterceptRule(rule.id, !rule.enabled);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const placeholder = KIND_OPTIONS.find((o) => o.value === form.kind)?.placeholder ?? "";

  const enabledCount = rules.filter((r) => r.enabled).length;
  const builtinCount = rules.filter((r) => r.builtin).length;
  const familyCounts = [
    { label: t("Exact match"), count: rules.filter((r) => r.kind.startsWith("exact_")).length, bar: "bg-emerald-500" },
    { label: t("Fuzzy match"), count: rules.filter((r) => r.kind.startsWith("fuzzy_")).length, bar: "bg-amber-500" },
    { label: t("CIDR"), count: rules.filter((r) => r.kind === "cidr").length, bar: "bg-sky-500" },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <BanIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-semibold text-xl leading-tight tracking-tight">{t("Asset interception")}</h1>
            <p className="mt-1 max-w-3xl text-muted-foreground text-sm">
              {t(
                "Global asset blocklist: matching domains / IPs / URLs / networks are intercepted; no operations run against them",
              )}
            </p>
          </div>
        </div>
        <Button onClick={openNew} className="shrink-0">
          <PlusIcon className="size-4" />
          {t("Create rule")}
        </Button>
      </div>

      {/* ≥2xl: rules table beside the summary / tester / guidance panel; narrower: panels in a row below */}
      <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_400px] min-[2200px]:grid-cols-[minmax(0,1fr)_440px]">
        <Card className="min-w-0">
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-muted-foreground text-sm">{t("Loading…")}</p>
            ) : rules.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <BanIcon className="size-8 text-muted-foreground/40" />
                <p className="text-muted-foreground text-sm">{t("No asset interception rules yet")}</p>
                <Button size="sm" variant="outline" onClick={openNew}>
                  <PlusIcon className="size-4" />
                  {t("Create the first rule")}
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[150px] pl-4">{t("Type")}</TableHead>
                    <TableHead className="w-[32%]">{t("Match content")}</TableHead>
                    <TableHead>{t("Note")}</TableHead>
                    <TableHead className="w-[84px] text-center">{t("Enabled")}</TableHead>
                    <TableHead className="w-[96px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id} className={!rule.enabled ? "opacity-50" : ""}>
                      <TableCell className="py-3 pl-4">
                        <KindBadge kind={rule.kind} />
                      </TableCell>
                      <TableCell className="max-w-0 py-3">
                        <code
                          className="block truncate rounded bg-muted px-2 py-1 font-mono text-sm"
                          title={rule.pattern}
                        >
                          {rule.pattern}
                        </code>
                      </TableCell>
                      <TableCell className="max-w-0 py-3 text-muted-foreground">
                        <div className="flex items-center gap-2">
                          {rule.builtin && (
                            <Badge variant="secondary" className="shrink-0">
                              {t("Built-in")}
                            </Badge>
                          )}
                          <span className="truncate" title={rule.note}>
                            {rule.note}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-center">
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={() => handleToggle(rule)}
                          aria-label={t("Enabled")}
                        />
                      </TableCell>
                      <TableCell className="py-3 pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label={t("Edit asset interception rule")}
                            onClick={() => openEdit(rule)}
                          >
                            <PencilIcon className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 text-destructive hover:text-destructive"
                            aria-label={t("Delete")}
                            onClick={() => handleDelete(rule)}
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <aside className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-1">
          {/* Summary */}
          <Card>
            <CardContent className="flex flex-col gap-4">
              <p className="font-semibold text-sm">{t("Rule summary")}</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="font-semibold text-2xl tabular-nums">{rules.length}</p>
                  <p className="text-muted-foreground text-xs">{t("Rules")}</p>
                </div>
                <div>
                  <p className="font-semibold text-2xl tabular-nums">{enabledCount}</p>
                  <p className="text-muted-foreground text-xs">{t("Enabled")}</p>
                </div>
                <div>
                  <p className="font-semibold text-2xl tabular-nums">{builtinCount}</p>
                  <p className="text-muted-foreground text-xs">{t("Built-in")}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {familyCounts.map((f) => (
                  <div key={f.label} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 text-muted-foreground">{f.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${f.bar}`}
                        style={{ width: rules.length ? `${(f.count / rules.length) * 100}%` : "0%" }}
                      />
                    </div>
                    <span className="w-6 text-right tabular-nums">{f.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <RuleTester />

          {/* How matching works (was a one-line caption) */}
          <Card className="md:col-span-2 lg:col-span-1">
            <CardContent className="flex flex-col gap-3">
              <p className="font-semibold text-sm">{t("How matching works")}</p>
              <ul className="flex flex-col gap-2 text-sm leading-relaxed">
                <li className="flex gap-2">
                  <KindBadge kind="exact_domain" />
                  <span className="text-muted-foreground">
                    {t("Exact match: the target must equal this content exactly")}
                  </span>
                </li>
                <li className="flex gap-2">
                  <KindBadge kind="fuzzy_domain" />
                  <span className="text-muted-foreground">
                    {t("Fuzzy match: hits when the target contains this content")}
                  </span>
                </li>
                <li className="flex gap-2">
                  <KindBadge kind="cidr" />
                  <span className="text-muted-foreground">{t("CIDR network, e.g. 192.168.0.0/16")}</span>
                </li>
              </ul>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t(
                  "Supports exact and fuzzy matching for domains / IPs / URLs, plus CIDR networks; ships with built-in fuzzy blocks for government (.gov / .gov.cn) and education (.edu / .edu.cn) sites",
                )}
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* editor sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>{editing ? t("Edit asset interception rule") : t("Create asset interception rule")}</SheetTitle>
            <SheetDescription className="text-xs">
              {t("Target assets matching this rule are intercepted globally")}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
            <Field label={t("Match type")}>
              <Select value={form.kind} onValueChange={(v) => set({ kind: v as AssetInterceptKind })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_GROUPS.map((g) => (
                    <React.Fragment key={g}>
                      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t(g)}
                      </div>
                      {KIND_OPTIONS.filter((o) => o.group === g).map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </React.Fragment>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label={t("Match content")}
              hint={
                form.kind === "cidr"
                  ? t("CIDR network, e.g. 192.168.0.0/16")
                  : form.kind.startsWith("fuzzy_")
                    ? t("Fuzzy match: hits when the target contains this content")
                    : t("Exact match: the target must equal this content exactly")
              }
            >
              <Input
                placeholder={placeholder}
                value={form.pattern}
                onChange={(e) => set({ pattern: e.target.value })}
              />
            </Field>

            <Field label={t("Note (optional)")}>
              <Textarea
                placeholder={t("Describe what this rule is for")}
                value={form.note}
                onChange={(e) => set({ note: e.target.value })}
                rows={2}
                className="resize-none"
              />
            </Field>

            <Separator />

            <div className="flex items-center gap-3">
              <Switch id="asset-rule-enabled" checked={form.enabled} onCheckedChange={(v) => set({ enabled: v })} />
              <Label htmlFor="asset-rule-enabled" className="cursor-pointer">
                {t("Enable this rule")}
              </Label>
            </div>
          </div>

          <SheetFooter className="border-t px-6 py-4 flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? t("Saving…") : t("Save")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
