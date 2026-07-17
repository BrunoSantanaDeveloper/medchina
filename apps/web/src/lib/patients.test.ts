import { findPatientDuplicates, normalizePatientName, type PatientOption } from "./patients";
import { describe, expect, it } from "vitest";

const patients: PatientOption[] = [
  { id: "one", fullName: "Márcia da Silva", birthDate: "1988-03-14", phone: "11999999999" },
  { id: "two", fullName: "Marcia de Souza", birthDate: null, phone: null },
];

describe("patient duplicate guidance", () => {
  it("normalizes accents, case and repeated whitespace", () => {
    expect(normalizePatientName("  MÁRCIA   DA SILVA ")).toBe("marcia da silva");
  });

  it("warns only on an exact normalized homonym", () => {
    expect(findPatientDuplicates(patients, "marcia da silva").map((patient) => patient.id)).toEqual(["one"]);
    expect(findPatientDuplicates(patients, "Marcia")).toEqual([]);
  });

  it("does not warn before a meaningful name is entered", () => {
    expect(findPatientDuplicates(patients, "   ")).toEqual([]);
  });
});
