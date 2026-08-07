export type ProductActionGroup = "create" | "navigate" | "continue";

export type ProductActionDefinition = {
  id: string;
  labelKey: string;
  descriptionKey: string;
  href: string;
  group: ProductActionGroup;
  keywords: readonly string[];
};

/** One registry powers the shell palette and any contextual action launcher. */
export const PRODUCT_ACTIONS = [
  {
    id: "new-patient",
    labelKey: "command-new-patient",
    descriptionKey: "command-new-patient-description",
    href: "/pacientes/novo",
    group: "create",
    keywords: ["paciente", "patient", "novo", "new", "cadastrar"],
  },
  {
    id: "import-patients",
    labelKey: "command-import-patients",
    descriptionKey: "command-import-patients-description",
    href: "/pacientes/importar",
    group: "create",
    keywords: ["importar", "import", "migrar", "migration", "planilha", "csv", "outro sistema"],
  },
  {
    id: "new-appointment",
    labelKey: "command-new-appointment",
    descriptionKey: "command-new-appointment-description",
    href: "/agenda?new=1",
    group: "create",
    keywords: ["agendar", "agenda", "consulta", "appointment", "novo"],
  },
  {
    id: "patients",
    labelKey: "command-patients",
    descriptionKey: "command-patients-description",
    href: "/pacientes",
    group: "navigate",
    keywords: ["pacientes", "patients", "cadastros"],
  },
  {
    id: "agenda",
    labelKey: "command-agenda",
    descriptionKey: "command-agenda-description",
    href: "/agenda",
    group: "navigate",
    keywords: ["agenda", "calendar", "appointment", "agendamento"],
  },
  {
    id: "library",
    labelKey: "command-library",
    descriptionKey: "command-library-description",
    href: "/biblioteca",
    group: "navigate",
    keywords: ["biblioteca", "library", "estudo", "study", "ia", "perguntar", "duvida", "dúvida"],
  },
  {
    id: "acervo",
    labelKey: "command-acervo",
    descriptionKey: "command-acervo-description",
    href: "/biblioteca/acervo",
    group: "navigate",
    keywords: ["acervo", "pontos", "points", "formulas", "fórmulas", "meridiano", "referencia", "referência"],
  },
  {
    id: "protocols",
    labelKey: "command-protocols",
    descriptionKey: "command-protocols-description",
    href: "/biblioteca/protocolos",
    group: "navigate",
    keywords: ["protocolo", "protocols", "meus", "anotacao", "anotação", "notes"],
  },
  {
    id: "getting-started",
    labelKey: "command-getting-started",
    descriptionKey: "command-getting-started-description",
    href: "/primeiros-passos",
    group: "navigate",
    keywords: ["onboarding", "começar", "ajuda", "demo", "ia", "manual"],
  },
  {
    id: "settings",
    labelKey: "command-settings",
    descriptionKey: "command-settings-description",
    href: "/settings",
    group: "navigate",
    keywords: ["configurações", "settings", "perfil", "conta"],
  },
  {
    id: "billing",
    labelKey: "command-billing",
    descriptionKey: "command-billing-description",
    href: "/settings/billing",
    group: "navigate",
    keywords: ["plano", "plan", "uso", "minutos", "billing", "assinatura"],
  },
  {
    id: "security",
    labelKey: "command-security",
    descriptionKey: "command-security-description",
    href: "/settings/security",
    group: "navigate",
    keywords: ["seguranca", "segurança", "mfa", "senha", "security", "2fa"],
  },
  {
    id: "help",
    labelKey: "command-help",
    descriptionKey: "command-help-description",
    href: "/ajuda",
    group: "navigate",
    keywords: ["ajuda", "suporte", "help", "duvida", "dúvida"],
  },
] as const satisfies readonly ProductActionDefinition[];

export type ProductActionId = (typeof PRODUCT_ACTIONS)[number]["id"];

/** Shared source for empty states, prominent CTAs and the command palette. */
export function getProductAction(id: ProductActionId) {
  const action = PRODUCT_ACTIONS.find((candidate) => candidate.id === id);
  if (!action) throw new Error("Unknown product action");
  return action;
}
