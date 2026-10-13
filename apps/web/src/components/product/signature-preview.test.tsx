import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import SignaturePreview from "@/components/product/signature-preview";
import messages from "@flyee/content/messages/pt-BR.json";
import { render, screen } from "@testing-library/react";

const product = messages.product as Record<string, string>;

const show = (props: React.ComponentProps<typeof SignaturePreview>) =>
  render(
    <NextIntlClientProvider locale="pt-BR" timeZone="America/Sao_Paulo" messages={messages}>
      <SignaturePreview {...props} />
    </NextIntlClientProvider>,
  );

/**
 * The preview must say what the issued PDF will say. It is built on the same
 * `credentialLines` the renderers use; these cases are the two that surprise:
 * a blank title is not a blank line, and a blank registration is no line at all.
 */
describe("SignaturePreview", () => {
  it("prints her title and her registration under her name", () => {
    show({ name: "Ana Lima", title: "Acupunturista", registration: "CNAA 3086", practiceName: "Espaço Ana Lima" });
    const figure = screen.getByRole("figure", { name: product["signature-preview-label"] });
    expect(figure).toHaveTextContent("Espaço Ana Lima");
    expect(figure).toHaveTextContent("Ana Lima");
    expect(figure).toHaveTextContent("Acupunturista");
    expect(figure).toHaveTextContent(`${product["doc-registration"]} CNAA 3086`);
  });

  it("falls back to the generic title and prints no registration line when both are blank", () => {
    show({ name: "Ana Lima", title: "  ", registration: "" });
    const figure = screen.getByRole("figure", { name: product["signature-preview-label"] });
    expect(figure).toHaveTextContent(product["plan-doc-professional"]);
    expect(figure).not.toHaveTextContent(product["doc-registration"]);
  });

  it("never shows an empty signature when the profile has no name yet", () => {
    show({ name: "", title: "", registration: "" });
    expect(screen.getByText(product["signature-preview-name-missing"])).toBeInTheDocument();
  });
});
