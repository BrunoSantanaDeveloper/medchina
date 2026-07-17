import { MenuItem } from "@/types";

/**
 * Production navigation is deliberately small: every destination advances a
 * real clinical job. Template showcases remain available only in development
 * and never enter this registry.
 */
export const leftMenuItems: MenuItem[] = [
  {
    id: "inicio",
    icon: "NiHome",
    label: "menu-inicio",
    description: "menu-inicio-description",
    color: "text-primary",
    href: "/inicio",
  },
  {
    id: "pacientes",
    icon: "NiUsers",
    label: "menu-pacientes",
    description: "menu-pacientes-description",
    color: "text-primary",
    href: "/pacientes",
  },
  {
    id: "agenda",
    icon: "NiCalendar",
    label: "menu-agenda",
    description: "menu-agenda-description",
    color: "text-primary",
    href: "/agenda",
  },
  {
    id: "primeiros-passos",
    icon: "NiPath",
    label: "menu-primeiros-passos",
    description: "menu-primeiros-passos-description",
    color: "text-primary",
    href: "/primeiros-passos",
  },
  {
    id: "admin",
    icon: "NiCrown",
    label: "menu-admin",
    description: "menu-admin-description",
    color: "text-primary",
    href: "/admin",
    superadminOnly: true,
    children: [
      {
        id: "admin-overview",
        icon: "NiDashboard",
        label: "menu-admin-overview",
        href: "/admin",
        description: "menu-admin-overview-description",
      },
      {
        id: "admin-organizations",
        icon: "NiBuilding",
        label: "menu-admin-organizations",
        href: "/admin/organizations",
        description: "menu-admin-organizations-description",
      },
      {
        id: "admin-billing",
        icon: "NiMoney",
        label: "menu-admin-billing",
        href: "/admin/billing",
        description: "menu-admin-billing-description",
      },
      {
        id: "admin-ai",
        icon: "NiAI",
        label: "menu-admin-ai",
        href: "/admin/ai",
        description: "menu-admin-ai-description",
      },
      {
        id: "admin-knowledge",
        icon: "NiBook",
        label: "menu-admin-knowledge",
        href: "/admin/knowledge",
        description: "menu-admin-knowledge-description",
      },
      {
        id: "admin-audit",
        icon: "NiShieldCheck",
        label: "menu-admin-audit",
        href: "/admin/audit",
        description: "menu-admin-audit-description",
      },
      {
        id: "admin-insights",
        icon: "NiChartLineBar",
        label: "menu-admin-insights",
        href: "/admin/insights",
        description: "menu-admin-insights-description",
      },
      {
        id: "admin-backups",
        icon: "NiArchive",
        label: "menu-admin-backups",
        href: "/admin/backups",
        description: "menu-admin-backups-description",
      },
      {
        id: "admin-announcements",
        icon: "NiAnnouncement",
        label: "menu-admin-announcements",
        href: "/admin/announcements",
        description: "menu-admin-announcements-description",
      },
      {
        id: "admin-help",
        icon: "NiQuestionHexagon",
        label: "menu-admin-help",
        href: "/admin/help",
        description: "menu-admin-help-description",
      },
      {
        id: "admin-blog",
        icon: "NiPen",
        label: "menu-admin-blog",
        href: "/admin/blog",
        description: "menu-admin-blog-description",
      },
      {
        id: "admin-support",
        icon: "NiHeadset",
        label: "menu-admin-support",
        href: "/admin/support",
        description: "menu-admin-support-description",
      },
    ],
  },
];

export const leftMenuBottomItems: MenuItem[] = [
  { id: "settings", label: "menu-settings", href: "/settings", icon: "NiSettings" },
];
