import { clearTabAlert, markTabAlert, resetTabAlertForTests } from "./capture-alert";
import { beforeEach, describe, expect, it } from "vitest";

const fakeDocument = (title: string) => ({ title }) as Document;

describe("tab alert", () => {
  beforeEach(() => resetTabAlertForTests());

  it("marks the tab so a glance reveals the failure", () => {
    const document = fakeDocument("Consulta — MedChina");
    markTabAlert(document, "Gravação interrompida");

    expect(document.title).toContain("Gravação interrompida");
    expect(document.title).not.toBe("Consulta — MedChina");
  });

  it("restores the title captured before the FIRST alert", () => {
    const document = fakeDocument("Consulta — MedChina");
    markTabAlert(document, "Gravação interrompida");
    // A second alert must not adopt the already-marked title as the original.
    markTabAlert(document, "Envio falhou");
    clearTabAlert(document);

    expect(document.title).toBe("Consulta — MedChina");
  });

  it("leaves the title untouched when clearing without an alert", () => {
    const document = fakeDocument("Consulta — MedChina");
    clearTabAlert(document);

    expect(document.title).toBe("Consulta — MedChina");
  });
});
