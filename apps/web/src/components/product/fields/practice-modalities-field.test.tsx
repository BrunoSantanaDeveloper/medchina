import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import PracticeModalitiesField from "@/components/product/fields/practice-modalities-field";
import type { PracticeModality } from "@/lib/practice-context";
import messages from "@flyee/content/messages/pt-BR.json";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const product = messages.product as Record<string, string>;

/**
 * The field holds two lists that are stored apart and mean different things:
 * the five product modalities (clinical effect) and what she typed (none).
 * These tests pin the boundary between them — the one mistake this control
 * must not make is letting a known modality be declared as free text, where
 * the therapeutic plan would quietly ignore it.
 */
function Harness({ known = [], other = [] }: { known?: PracticeModality[]; other?: string[] }) {
  const [knownValue, setKnown] = useState<PracticeModality[]>(known);
  const [otherValue, setOther] = useState<string[]>(other);
  return (
    <NextIntlClientProvider locale="pt-BR" timeZone="America/Sao_Paulo" messages={messages}>
      <PracticeModalitiesField value={knownValue} onChange={setKnown} other={otherValue} onOtherChange={setOther} />
      <output data-testid="known">{knownValue.join("|")}</output>
      <output data-testid="other">{otherValue.join("|")}</output>
      <button type="button">outside</button>
    </NextIntlClientProvider>
  );
}

const known = () => screen.getByTestId("known").textContent;
const other = () => screen.getByTestId("other").textContent;
const field = () => screen.getByRole("combobox");

// Typing character by character into an MUI Autocomplete under jsdom costs
// seconds per test; the default 5 s cuts the longer inputs off mid-word.
describe("PracticeModalitiesField", { timeout: 30_000 }, () => {
  it("picks a product modality from the list as its slug", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());
    await user.click(await screen.findByRole("option", { name: product["practice-modality-cupping"] }));
    expect(known()).toBe("cupping");
    expect(other()).toBe("");
  });

  it("adds a practice outside the list, as she wrote it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "Tui  Na{Enter}");
    expect(other()).toBe("Tui Na");
    expect(known()).toBe("");
  });

  it("offers a row to add what she typed — Enter is not the only way", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "Shiatsu");
    await user.click(await screen.findByRole("option", { name: "Adicionar “Shiatsu”" }));
    expect(other()).toBe("Shiatsu");
  });

  it("turns a known modality typed by hand into the known one, never an 'other'", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "acupuntura{Enter}");
    await user.type(field(), "MOXABUSTAO{Enter}");
    expect(known()).toBe("acupuncture|moxibustion");
    expect(other()).toBe("");
  });

  it("does not offer to add a known modality as free text", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "auriculoterapia");
    expect(screen.queryByRole("option", { name: /^Adicionar/ })).toBeNull();
  });

  it("refuses a label a spreadsheet would read as a formula, and says why", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "=cmd{Enter}");
    expect(other()).toBe("");
    expect(screen.getByText(product["practice-modality-other-issue-leading_symbol"])).toBeInTheDocument();
  });

  it("refuses a one-letter label", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "x{Enter}");
    expect(other()).toBe("");
    expect(screen.getByText(product["practice-modality-other-issue-too_short"])).toBeInTheDocument();
  });

  it("ends a label at a comma", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "Shiatsu,Reiki,");
    expect(other()).toBe("Shiatsu|Reiki");
  });

  it("keeps what she was typing when she leaves the field", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), "Quiropraxia");
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(other()).toBe("Quiropraxia");
  });

  it("does not repeat a label that differs only in case", async () => {
    const user = userEvent.setup();
    render(<Harness other={["Tui Na"]} />);
    await user.type(field(), "tui na{Enter}");
    expect(other()).toBe("Tui Na");
  });

  it("stops at ten labels and says so", async () => {
    const user = userEvent.setup();
    const ten = Array.from({ length: 10 }, (_, index) => `Prática ${index + 1}`);
    render(<Harness other={ten} />);
    await user.type(field(), "Mais uma{Enter}");
    expect(other()).toBe(ten.join("|"));
    expect(screen.getByText(product["practice-modality-other-issue-too_many"])).toBeInTheDocument();
  });

  it("removes a label without touching the other list", async () => {
    const user = userEvent.setup();
    render(<Harness known={["acupuncture"]} other={["Tui Na"]} />);
    await user.click(field());
    await user.keyboard("{Backspace}");
    expect(other()).toBe("");
    expect(known()).toBe("acupuncture");
  });
});
