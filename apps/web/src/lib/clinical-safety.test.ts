import { detectSafetyFlags, safetyFlagTerm } from "./clinical-safety";
import { describe, expect, it } from "vitest";

describe("what a document that leaves the practice may show about a safety flag", () => {
  it("keeps the whole recorded text as evidence for the professional", () => {
    const [flag] = detectSafetyFlags([
      { text: "Usa ansiolítico à noite e fuma maconha desde os 20", fieldKey: "routine.substances" },
    ]);
    expect(flag.category).toBe("medication");
    expect(flag.matchedText).toBe("Usa ansiolítico à noite e fuma maconha desde os 20");
  });

  it("prints only the word that raised it — never the sentence", () => {
    // The stem in the pattern is "ansiol[íi]tic"; the patient reads the full word.
    expect(
      safetyFlagTerm({ category: "medication", matchedText: "Usa ansiolítico à noite e fuma maconha desde os 20" }),
    ).toBe("ansiolítico");
    expect(safetyFlagTerm({ category: "anticoagulant", matchedText: "tomo Xarelto 20mg desde março" })).toBe("Xarelto");
    expect(safetyFlagTerm({ category: "pacemaker", matchedText: "Tem marca-passo desde 2019" })).toBe("marca-passo");
    expect(safetyFlagTerm({ category: "pregnancy", matchedText: "Está grávida de 8 semanas" })).toBe("grávida");
  });

  it("falls back to the category alone when the text no longer matches", () => {
    expect(safetyFlagTerm({ category: "allergy", matchedText: "texto editado depois" })).toBe("");
    expect(safetyFlagTerm({ category: "unknown", matchedText: "alergia" })).toBe("");
    expect(safetyFlagTerm({ category: "allergy", matchedText: null })).toBe("");
  });
});

describe("what the safety scan must never let pass", () => {
  const categories = (values: { text: string; fieldKey?: string }[]) =>
    detectSafetyFlags(values).map((flag) => flag.category);

  it("matches a word that opens with an accented letter — 'úlcera' was invisible to \b", () => {
    expect(categories([{ text: "Tem úlcera varicosa na perna direita" }])).toContain("lesion");
    expect(categories([{ text: "Úlcera na perna" }])).toContain("lesion");
    // Still a word START: inside another word it is nothing.
    expect(categories([{ text: "Usa baas no café" }])).toEqual([]);
  });

  it("treats anything recorded in the medications field as a medication, known name or not", () => {
    // No pattern knows this compounded formula — the field says what it is.
    const [flag] = detectSafetyFlags([
      { text: "Fórmula manipulada XPTO 2 cápsulas/dia", fieldKey: "complaint.medications" },
    ]);
    expect(flag).toEqual({
      category: "medication",
      matchedText: "Fórmula manipulada XPTO 2 cápsulas/dia",
      fieldKey: "complaint.medications",
    });
  });

  it("keeps the medications list as the evidence, over a passing mention elsewhere", () => {
    const flags = detectSafetyFlags([
      { text: "Insônia, usa remédio para dormir às vezes", fieldKey: "chiefComplaint" },
      { text: "Zolpidem 10 mg\nChá de camomila", fieldKey: "complaint.medications" },
    ]);
    expect(flags.find((flag) => flag.category === "medication")).toMatchObject({
      matchedText: "Zolpidem 10 mg\nChá de camomila",
      fieldKey: "complaint.medications",
    });
  });

  it("raises the medication flag beside a more specific one taken from the same list", () => {
    expect(categories([{ text: "Xarelto 20 mg\nVitamina D", fieldKey: "complaint.medications" }])).toEqual([
      "anticoagulant",
      "medication",
    ]);
  });

  it("does not turn a denial written in the medications field into a medication", () => {
    for (const text of ["Nenhum", "Não usa", "- não toma nada contínuo", "Sem uso no momento", "não informado"]) {
      expect(categories([{ text, fieldKey: "complaint.medications" }]), text).toEqual([]);
    }
    // A denial on one line does not hide what the next line records.
    expect(
      categories([{ text: "Nenhum contínuo\nChá de hibisco todo dia", fieldKey: "complaint.medications" }]),
    ).toEqual(["medication"]);
  });
});

describe("the drugs, procedures and states a Brazilian chart actually records", () => {
  const categories = (text: string) => detectSafetyFlags([{ text }]).map((flag) => flag.category);

  it.each([
    // The synthetic A/B consultations whose plans came out with no caution at all.
    ["omeprazol 20 mg em jejum", "medication"],
    ["Losartana 50 mg, esquece às vezes", "medication"],
    ["sulfato ferroso desde o exame", "medication"],
    ["pílula anticoncepcional, primeira cartela", "medication"],
    ["suplemento de magnésio", "medication"],
    ["reposição hormonal suspensa por conta própria", "medication"],
    ["diclofenaco quando o ombro dói", "medication"],
    ["parto cesárea em 2020", "surgery"],
    // How it is said in the room.
    ["toma remédio pra afinar o sangue", "anticoagulant"],
    ["foi operada da vesícula", "surgery"],
    ["histerectomia total em 2018", "surgery"],
    ["tem pino na perna esquerda", "surgery"],
    ["a menstruação está atrasada", "pregnancy"],
    ["tentando engravidar há um ano", "pregnancy"],
    ["no segundo trimestre", "pregnancy"],
    ["puérpera de 20 dias", "breastfeeding"],
    ["está dando de mamar", "breastfeeding"],
    ["dipirona me dá reação", "allergy"],
    ["linfedema no braço direito", "lesion"],
    ["implante coclear", "pacemaker"],
  ])("%s → %s", (text, category) => {
    expect(categories(text)).toContain(category);
  });

  it.each([
    // What used to raise "pregnancy" for patients who are not pregnant.
    "nulípara",
    "piorou no último trimestre do ano",
    // Ordinary consultation words close to the stems.
    "Começou em abril",
    "dor frontal ao acordar",
    "dieta anti-inflamatória e alimentos mornos",
    "fitoterapia chinesa com Xiao Yao San",
    "trabalha numa operadora de saúde",
    "tomou vitamina de banana no café",
    "progesterona baixa no exame",
    "resistência à insulina no exame",
    "pino de boliche aos domingos",
    "placa bacteriana no dentista",
    "hipersensibilidade ao frio",
    "reação ao estresse no trabalho",
    "ela dá mamão ao filho",
    "anatomia do ombro",
    "Língua pálida com saburra branca",
  ])("%s → nothing", (text) => {
    expect(categories(text)).toEqual([]);
  });
});

describe("what the adversarial review caught", () => {
  const categories = (text: string) => detectSafetyFlags([{ text }]).map((flag) => flag.category);
  const listed = (text: string) =>
    detectSafetyFlags([{ text, fieldKey: "complaint.medications" }]).map((flag) => flag.category);

  it.each([
    // Written with a space, the commonest spelling.
    ["Tem marca passo", "pacemaker"],
    ["Beta HCG positivo há 3 dias", "pregnancy"],
    ["BHCG positivo", "pregnancy"],
    ["o beta deu positivo", "pregnancy"],
    ["pré natal em dia", "pregnancy"],
    ["pós parto de 15 dias", "breastfeeding"],
    ["toma anti inflamatório", "medication"],
    ["usa medicacao para pressão", "medication"],
    // The accentless verb where it cannot be the preposition.
    ["da de mamar à noite", "breastfeeding"],
    ["dipirona me da reação", "allergy"],
    // Taken, not measured.
    ["valerato de estradiol 2 mg", "medication"],
    ["toma estradiol 1 mg", "medication"],
    ["Vitamina D3 2000 UI", "medication"],
    ["vitamina D 50.000 UI semanal", "medication"],
    ["toma vitamina B12", "medication"],
    ["usa anti-inflamatórios para a dor", "medication"],
    // In the body.
    ["parafusos na coluna", "surgery"],
    ["transplante renal em 2010", "surgery"],
    ["é transplantada renal", "surgery"],
    ["tenho silicone nos seios", "surgery"],
    ["está de resguardo, bebê de 20 dias", "breastfeeding"],
    ["resguardo pós-parto", "breastfeeding"],
  ])("%s → %s", (text, category) => {
    expect(categories(text)).toContain(category);
  });

  it.each([
    "Retirada da mama esquerda em 2019",
    "Sensibilidade no bico da mama na TPM",
    "Ficou com vergonha da reação que teve",
    "Intensidade 7 de 10, gravidade moderada",
    "sem sinais de gravidade",
    "Está injuriada com a situação no trabalho",
    "estradiol baixo no exame, FSH alto",
    "deficiência de vitamina D",
    "Exames: vitamina D 18, ferritina baixa",
    "vitamina B12 baixa no exame",
    "gosta de alimentos anti-inflamatórios como gengibre",
    "o gengibre tem efeito anti-inflamatório",
    "dieta anti inflamatória",
    "Trabalha em fábrica, apertando parafusos na esteira",
    "Faz bicos de costura para suplementar a renda",
    "trabalha na saúde suplementar",
    "Ficou de resguardo uma semana por causa da dengue",
    "Transplantou as orquídeas",
    "coloquei silicone no box",
    "pino na tomada deu choque",
  ])("%s → nothing", (text) => {
    expect(categories(text)).toEqual([]);
  });

  it.each([
    "Paciente nega",
    "Negou",
    "Nada",
    "Não",
    "Atualmente nenhum",
    "Não está tomando nada",
    "— Nenhum",
    "—",
    "N/A",
    "Nenhum, por enquanto",
    "Não usa, nem chá",
  ])("the medications field reading %s records no medication", (text) => {
    expect(listed(text)).toEqual([]);
  });

  it.each([
    "Nega. Toma ômega 3.",
    "Nenhum contínuo, só ômega 3 todo dia",
    "Sem uso contínuo, mas toma cúrcuma em cápsula diariamente",
  ])("a denial does not hide the product named after it: %s", (text) => {
    expect(listed(text)).toEqual(["medication"]);
  });
});
