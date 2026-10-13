import ScopeStep, { type ScopeValues } from "./scope-step";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimezoneProposal } from "@/lib/practice-context";
import messages from "@flyee/content/messages/pt-BR.json";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@flyee/auth/client", () => ({ createClient: () => ({ rpc }) }));

const product = messages.product as Record<string, string>;
const FORM = "scope-form";
const ORG = "org-1";

const SILENT: TimezoneProposal = { kind: "silent", timezone: "America/Sao_Paulo", source: "browser" };
const ASK: TimezoneProposal = { kind: "ask", browser: "America/Manaus", stored: "America/Sao_Paulo" };

function show(
  timezone: TimezoneProposal,
  initial: Omit<ScopeValues, "timezone"> = { modalities: [], other: [], fertility: false },
) {
  const onCompleted = vi.fn();
  render(
    <NextIntlClientProvider locale="pt-BR" timeZone="America/Sao_Paulo" messages={messages}>
      <ScopeStep
        formId={FORM}
        orgId={ORG}
        initial={initial}
        timezone={timezone}
        onSubmittingChange={() => undefined}
        onCompleted={onCompleted}
      />
      {/* In the wizard the primary button lives outside the form and submits it by id. */}
      <button type="submit" form={FORM}>
        salvar
      </button>
    </NextIntlClientProvider>,
  );
  return { onCompleted, save: () => userEvent.click(screen.getByRole("button", { name: "salvar" })) };
}

const saved = (overrides: Record<string, unknown> = {}) => ({
  data: {
    ok: true,
    code: "completed",
    timezone: "America/Sao_Paulo",
    practice_modalities: [],
    practice_modalities_other: [],
    practice_areas: [],
    ...overrides,
  },
  error: null,
});

beforeEach(() => {
  rpc.mockReset();
});

/**
 * The step's contract with `complete_practice_scope` (migration 0119): what it
 * sends, what it says about where the timezone came from, and what it shows
 * before she leaves the screen.
 */
describe("ScopeStep", () => {
  it("asks nothing about the timezone when the browser agrees, and says the browser was the source", async () => {
    rpc.mockResolvedValue(saved());
    const { onCompleted, save } = show(SILENT);
    expect(screen.queryByText(product["prep-timezone-question"])).toBeNull();
    await save();
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("complete_practice_scope", {
      target_org: ORG,
      target_timezone: "America/Sao_Paulo",
      target_modalities: [],
      target_modalities_other: [],
      target_areas: [],
      target_timezone_source: "browser",
    });
  });

  it("asks which clock is right when they differ, with the browser's first and selected", async () => {
    rpc.mockResolvedValue(saved({ timezone: "America/Manaus" }));
    const { onCompleted, save } = show(ASK);
    const group = screen.getByRole("radiogroup", { name: product["prep-timezone-question"] });
    const radios = screen.getAllByRole("radio");
    expect(group).toBeInTheDocument();
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    await save();
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1]).toMatchObject({ target_timezone: "America/Manaus", target_timezone_source: "chosen" });
    expect(onCompleted.mock.calls[0][0].timezone).toBe("America/Manaus");
  });

  it("sends the other clock when she picks it", async () => {
    rpc.mockResolvedValue(saved());
    const { onCompleted, save } = show(ASK);
    await userEvent.click(screen.getAllByRole("radio")[1]);
    await save();
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1]).toMatchObject({
      target_timezone: "America/Sao_Paulo",
      target_timezone_source: "chosen",
    });
  });

  it("never re-asks a confirmed timezone", async () => {
    rpc.mockResolvedValue(saved());
    const { onCompleted, save } = show({ kind: "kept", timezone: "America/Bahia" });
    expect(screen.queryByText(product["prep-timezone-question"])).toBeNull();
    await save();
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1]).toMatchObject({ target_timezone: "America/Bahia", target_timezone_source: "kept" });
  });

  it("falls back to the stored zone when the database does not know the browser's", async () => {
    rpc
      .mockResolvedValueOnce({ data: { ok: false, code: "invalid_timezone" }, error: null })
      .mockResolvedValueOnce(saved());
    const { onCompleted, save } = show({ kind: "ask", browser: "Antiga/Zona", stored: "America/Sao_Paulo" });
    await save();
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1]).toMatchObject({
      target_timezone: "America/Sao_Paulo",
      target_timezone_source: "default",
    });
  });

  it("sends the five and her own words as two lists, and the area", async () => {
    rpc.mockResolvedValue(
      saved({
        practice_modalities: ["acupuncture", "cupping"],
        practice_modalities_other: ["Tui Na"],
        practice_areas: ["fertility"],
      }),
    );
    const { onCompleted, save } = show(SILENT, {
      modalities: ["cupping", "acupuncture"],
      other: ["Tui Na"],
      fertility: true,
    });
    await save();
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1]).toMatchObject({
      target_modalities: ["cupping", "acupuncture"],
      target_modalities_other: ["Tui Na"],
      target_areas: ["fertility"],
    });
    // What the page keeps is what the database normalised, in the product's order.
    expect(onCompleted.mock.calls[0][0]).toEqual({
      modalities: ["acupuncture", "cupping"],
      other: ["Tui Na"],
      fertility: true,
      timezone: "America/Sao_Paulo",
    });
  });

  it("says what each answer changes before she leaves the step", () => {
    show(SILENT, { modalities: ["acupuncture", "auriculotherapy"], other: ["Tui Na"], fertility: true });
    const panel = screen.getByRole("status");
    expect(panel).toHaveTextContent("Acupuntura e Auriculoterapia");
    // Honest about free text: recorded, and changing nothing yet.
    expect(panel).toHaveTextContent("Tui Na");
    expect(panel).toHaveTextContent("Ainda não muda o plano nem a biblioteca");
    expect(panel).toHaveTextContent("ciclo menstrual e fertilidade");
  });

  it("says that declaring nothing restricts nothing", () => {
    show(SILENT);
    expect(screen.getByRole("status")).toHaveTextContent(product["prep-scope-effect-all"]);
  });

  it("stays on the step and names the problem when the save is refused", async () => {
    rpc.mockResolvedValue({ data: { ok: false, code: "invalid_modality_other" }, error: null });
    const { onCompleted, save } = show(SILENT, { modalities: [], other: ["Tui Na"], fertility: false });
    await save();
    expect(await screen.findByText(product["prep-scope-error-other"])).toBeInTheDocument();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it("stays on the step when the request itself fails", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    const { onCompleted, save } = show(SILENT);
    await save();
    expect(await screen.findByText(product["prep-save-error"])).toBeInTheDocument();
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
