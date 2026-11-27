import {
  Activity,
  Ban,
  BellRing,
  BookOpen,
  Bot,
  Brain,
  Bug,
  ClipboardList,
  Compass,
  Crosshair,
  FolderOpen,
  FolderSync,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  Network,
  Plug,
  Radar,
  Radio,
  ScrollText,
  Settings2,
  ShieldAlert,
  Sparkles,
  Target,
  Terminal,
  Wrench,
} from "lucide-react";

import { t } from "@/i18n";

export type NavBadge = "new" | "soon";

export interface NavSubItem {
  id: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

interface NavItemBase {
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

// Grouped by VMDR pillar (see lib/vmdr/pillars.ts), so every section has one unmistakable job:
// posture/focus, what exists, what was tested, what is exposed, and what is allowed. Operations,
// system settings and learning resources sit below the primary VMDR flow.
export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: t("Posture & Focus"),
    items: [
      { id: "focus", title: t("Focus Queue"), url: "/focus", icon: Crosshair },
      { id: "dashboard", title: t("Overview Dashboard"), url: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    id: 2,
    label: t("Discovered Assets"),
    items: [
      { id: "assets", title: t("Inventory & Asset Graph"), url: "/function/assets", icon: Network },
      { id: "sync", title: t("Discovery Sources"), url: "/function/sync", icon: FolderSync },
    ],
  },
  {
    id: 3,
    label: t("Coverage Status"),
    items: [{ id: "coverage", title: t("Test Coverage"), url: "/coverage", icon: Radar }],
  },
  {
    id: 4,
    label: t("Risk Exposure"),
    items: [
      { id: "findings", title: t("Findings & Remediation"), url: "/function/findings", icon: Bug },
      { id: "traffic", title: t("HTTP Evidence"), url: "/function/traffic", icon: Activity },
    ],
  },
  {
    id: 5,
    label: t("Scope & Guardrails"),
    items: [
      { id: "intercept", title: t("Scope & Interception Rules"), url: "/system/intercept", icon: ShieldAlert },
      { id: "asset-intercept", title: t("Asset Blocklist"), url: "/system/intercept/assets", icon: Ban },
      { id: "approvals", title: t("Approvals"), url: "/system/intercept/approvals", icon: ClipboardList },
    ],
  },
  {
    id: 6,
    label: t("Operations"),
    items: [
      { id: "tasks", title: t("Tasks"), url: "/function/tasks", icon: Target },
      { id: "chat", title: t("Chat"), url: "/chat", icon: MessageSquare },
      { id: "commands", title: t("Tool Execution"), url: "/function/commands", icon: Terminal },
      { id: "llm-records", title: t("LLM Recording"), url: "/function/llm-records", icon: Radio },
      { id: "workspace", title: t("Workspace"), url: "/function/workspace", icon: FolderOpen },
    ],
  },
  {
    id: 7,
    label: t("System"),
    items: [
      { id: "llm", title: t("LLM"), url: "/system/llm", icon: Brain },
      { id: "agents", title: t("Agent"), url: "/system/agents", icon: Bot },
      { id: "mcp", title: t("MCP"), url: "/system/mcp", icon: Plug },
      { id: "skills", title: t("Skill"), url: "/system/skills", icon: Sparkles },
      { id: "tools", title: t("Tools"), url: "/system/tools", icon: Wrench },
      { id: "notify", title: t("Notifications"), url: "/system/notify", icon: BellRing },
      { id: "logs", title: t("Logs"), url: "/system/logs", icon: ScrollText },
      { id: "settings", title: t("System Settings"), url: "/system/settings", icon: Settings2 },
    ],
  },
  {
    id: 8,
    label: t("Learn"),
    items: [
      // Rendered as a button that starts the tour (see nav-main.tsx); the url is the shareable deep link.
      { id: "walkthrough", title: t("Guided Walkthrough"), url: "/function/assets/?tour=1&step=1", icon: Compass },
      { id: "docs", title: t("Learn ARTEX"), url: "/docs", icon: BookOpen },
    ],
  },
];
