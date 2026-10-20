/**
 * Clinically sensitive factors that must never be hidden (PRD §10.10:
 * "Não ocultar contraindicações conhecidas. Destacar medicamentos, gestação,
 * anticoagulantes, marcapasso, cirurgias, lesões e alergias relevantes").
 *
 * This lives on its own because it is enforced in TWO places — the anamnesis
 * extraction flags these for review, and the therapeutic plan surfaces them as
 * cautions on every modality — and both must agree. It is CODE, not prompt: a
 * model that forgets to mention an anticoagulant cannot make the alert vanish.
 *
 * Multilingual: the consultation language follows the workspace, not the code.
 *
 * A flag says "this factor is present, verify its implications" — never "do X".
 * The professional judges the contraindication; the software only refuses to
 * let it go unnoticed.
 */

export type SafetyCategory =
  | "medication"
  | "anticoagulant"
  | "pacemaker"
  | "pregnancy"
  | "breastfeeding"
  | "surgery"
  | "allergy"
  | "lesion";

/**
 * Ordered most-acute first, so a value matching several leads with the sharpest.
 *
 * Brand names matter as much as the generic stems: a patient says "tomo
 * Xarelto", never "tomo um inibidor do fator Xa", and a scan that only knew the
 * stems read that sentence as unremarkable. The list covers what is actually
 * dispensed in Brazil; add to it rather than relying on the model to notice.
 *
 * Each term is a regex alternative that must START a word (see WORD_START), in
 * lower case, with Latin-1 accent classes ([áa]) so the spelling with and
 * without accents both match.
 */
/**
 * A bone or a limb right after "no/na…": a pin or a screw in the body — not
 * in a machine ("parafusos na esteira") or a socket ("pino na tomada").
 */
const IN_A_BONE =
  "(?=\\s+(?:no|na|nos|nas)\\s+(?:(?:meu|minha|seu|sua)\\s+)?(?:coluna|v[ée]rtebras?|joelhos?|pernas?|bra[çc]os?|antebra[çc]os?|p[ée]s?|tornozelos?|quadril|bacia|f[êe]mur|t[íi]bia|f[íi]bula|[úu]mero|ombros?|cotovelos?|punhos?|m[ãa]os?|dedos?|clav[íi]cula|costelas?|calcanhar|mand[íi]bula|maxilar|ossos?|fratura)(?![a-z0-9à-ÿ]))";

/**
 * What marks a vitamin or a hormone as TAKEN rather than measured: a use verb
 * before it, or a dose after it. "Vitamina D baixa", "deficiência de vitamina
 * D" and "estradiol 18 no exame" are lab results.
 */
const TAKEN_BEFORE =
  "(?<=(?:toma|tomo|tomando|tomou|usa|uso|usando|suplementa|suplementando|rep[õo]e|reposi[çc][ãa]o de|reposi[çc][ãa]o com)\\s(?:de\\s)?)";
const DOSE_AFTER =
  "(?=\\s*\\d[\\d.,]*\\s*(?:ui\\b|mil\\b|mcg|[µu]g\\b|mg\\b|gotas?|c[áa]psul|comprimid|semana|di[áa]ri|por dia|ao dia|x\\b))";

const CATEGORY_TERMS: { category: SafetyCategory; terms: string[] }[] = [
  {
    // Anticoagulants AND antiplatelets: what they share is the bleeding risk
    // under a needle, a cup or a lancet.
    category: "anticoagulant",
    terms: [
      "anticoagul",
      "antiagreg",
      "varfarin",
      "warfarin",
      "heparin",
      "enoxaparin",
      "nadroparin",
      "fraxiparin",
      "fondaparin",
      "arixtra",
      "rivaroxab",
      "apixab",
      "dabigatr",
      "edoxab",
      "clopidogrel",
      "ticagrelor",
      "prasugrel",
      "cilostazol",
      "dipiridamol",
      "aas\\b",
      "aspirin",
      "acetilsalic",
      "somalgin",
      "ecasil",
      "marevan",
      "coumadin",
      "xarelto",
      "eliquis",
      "pradaxa",
      "lixiana",
      "clexane",
      "plavix",
      "iscover",
      "brilinta",
      "effient",
      "marcoumar",
      // How it is said in the room: "tomo remédio pra afinar o sangue".
      "afina(?:r|dor)?\\s+(?:o\\s+|d[eo]\\s+)?sangue",
    ],
  },
  {
    // Implanted electronics: what electroacupuncture must never run across.
    category: "pacemaker",
    terms: [
      // Compound words are written with a hyphen, a space or neither — "marca passo" is the commonest.
      "marca[- ]?passo",
      "pacemaker",
      "desfibril",
      "stent",
      "cardio[- ]?desfibril",
      "cdi\\b",
      "ressincroniz",
      "bomba de insulina",
      "bomba de infus[ãa]o",
      "neuroestimulad",
      "estimulador (?:medular|card[íi]aco|cerebral|do (?:nervo )?vago)",
      "implante coclear",
    ],
  },
  {
    // Present or possible pregnancy. "Nulípara" (never gave birth) and a bare
    // "trimestre" (a quarter of a year, "piorou no último trimestre") used to
    // raise this flag for patients who are not pregnant.
    category: "pregnancy",
    terms: [
      "gestante",
      // Grávida, gravidez — never "gravidade" (severity), which any patient may have.
      "gr[áa]vid(?!ade)",
      "pregnan",
      "gesta[çc][ãa]o",
      "semanas de gesta",
      "gest[aá]cional",
      "primigest",
      "(?:primeiro|segundo|terceiro|[123][º°o]?)\\s+trimestre",
      "pr[ée][- ]?natal",
      "beta[- ]?hcg",
      "bhcg",
      "beta\\s+(?:deu\\s+)?positivo",
      // Possible pregnancy and trying to conceive: the same points and herbs
      // are cautioned.
      "atraso (?:menstrual|da menstrua)",
      "menstrua[çc][ãa]o\\s+(?:est[áa]\\s+)?atrasad",
      "engravid",
      "fertiliza[çc][ãa]o in vitro",
      "fiv\\b",
      "insemina[çc][ãa]o",
    ],
  },
  {
    category: "breastfeeding",
    terms: [
      "amamenta",
      "lactante",
      "lacta[çc][ãa]o",
      "aleitamento",
      "leite materno",
      // "Dá mama", "dando de mamar" — the verb needs its accent: "da mama"
      // is the preposition ("retirada da mama esquerda"), except before "de mamar".
      "(?:dando|dá|dar)\\s+(?:de\\s+)?mam(?:a|ar)\\b",
      "d[áa]\\s+de\\s+mamar",
      "breastfeed",
      "pu[ée]rp",
      "p[óo]s[- ]?parto",
      // The postpartum "resguardo" — not resting from a flu ("de resguardo uma
      // semana por causa da dengue"). Context required, word printed.
      "resguardo\\s+(?:d[oa]\\s+|p[óo]s[- ]?)(?:parto|ces[áa]rea)",
      "(?<=de )resguardo(?=[ \\t]*(?:$|[\\r\\n,.;:)]))",
    ],
  },
  {
    category: "surgery",
    terms: [
      "cirurgi",
      "p[óo]s[- ]?operat",
      "surgery",
      "surgical",
      "operad[oa]\\b",
      "operou\\b",
      "operei\\b",
      "ces[áa]re",
      "cesarian",
      "laparosc",
      "videolaparosc",
      "laparotom",
      "toracotom",
      "craniotom",
      "episiotom",
      "artroscop",
      // Any "-ectomia" (histerectomia, mastectomia, colecistectomia…) and any
      // "-plastia" (artroplastia, angioplastia, abdominoplastia…) is a procedure.
      "[a-zà-ÿ]+ectomi",
      "[a-zà-ÿ]+plastia",
      "bari[áa]tric",
      "bypass",
      "redu[çc][ãa]o de est[ôo]mago",
      // The noun and the patient — not the verb ("transplantou as orquídeas").
      "transplant(?:es?|ad[oa]s?)(?![a-z0-9à-ÿ])",
      "amputa",
      "ponte de safena",
      "revasculariz",
      "laqueadura",
      "ligadura de trompas",
      // Metal and implants: what a needle, heat or a current must account for.
      "pr[óo]tese",
      "implante met[áa]lic",
      "implante (?:mam[áa]rio|de silicone)",
      // Context required, word printed: a document reads "silicone", "pino",
      // never "coloquei silicone" or "pino na". The context is the body —
      // "silicone no box", "parafusos na esteira" and "pino na tomada" are not.
      "(?<=(?:botei|coloquei|tenho|pus|fiz)\\s)silicone(?!\\s+(?:no|na|nos|nas)\\s+(?!(?:seios?|mamas?|peitos?|bumbum|gl[úu]teos?|n[áa]degas?|panturrilhas?)(?![a-z0-9à-ÿ])))",
      "osteoss[íi]ntese",
      `pinos?${IN_A_BONE}`,
      "pinos? de tit[âa]nio",
      `parafusos?${IN_A_BONE}`,
      "placa (?:de )?tit[âa]nio",
      "placa met[áa]lic",
      "haste (?:intramedular|met[áa]lic)",
    ],
  },
  {
    category: "allergy",
    terms: [
      "alergi",
      "al[ée]rgic",
      "allerg",
      "intoler[âa]nci",
      "anafila",
      "urtic[áa]ri",
      "angioedema",
      "edema de glote",
      "rea[çc][ãa]o (?:adversa|cut[âa]nea)",
      // "Dipirona me dá reação" — the accentless "da" only after a pronoun:
      // otherwise it is the preposition ("vergonha da reação que teve").
      "(?:dá|dou|deu|deram)\\s+rea[çc][ãa]o",
      "(?:me|lhe|te|nos)\\s+d[áa]\\s+rea[çc][ãa]o",
    ],
  },
  {
    // Where needles, cups, gua sha and heat must stay away.
    category: "lesion",
    terms: [
      "les[ãa]o",
      "les[õo]es",
      "ferida",
      "[úu]lcera",
      "varizes",
      "variz\\b",
      "trombos",
      "tromboflebit",
      "flebit",
      "emboli",
      "tvp\\b",
      "ferimento",
      "wound",
      // English only: the Portuguese "injuriada" means upset, not hurt.
      "injur(?:y|ies|ed|e|ing)\\b",
      "dermatit",
      "eczem",
      "psor[íi]as",
      "queimadur",
      "micose",
      "erisipel",
      "celulite infecciosa",
      "abscess",
      "fur[úu]nc",
      "herpes",
      "cobreiro",
      "z[óo]ster",
      "escaras?\\b",
      "necros",
      "gangren",
      "hematoma",
      "linfedema",
      "quel[óo]ide",
    ],
  },
  // General medications last: the specific families above are more informative.
  {
    category: "medication",
    terms: [
      "medica[çc]",
      "medicament",
      "rem[ée]dio",
      "f[áa]rmaco",
      // The noun — not "suplementar a renda" or "saúde suplementar".
      "suplement(?:os?|a[çc][ãa]o|a[çc][õo]es)(?![a-z0-9à-ÿ])",
      // Contraception and hormones — by the drug or the device, never by
      // "hormônio" alone: "progesterona baixa" is a lab result, and a talk
      // about hormones is not a prescription.
      "anticoncepci",
      "anticonceptiv",
      "p[íi]lulas?\\b",
      "diu hormonal",
      "mirena",
      "kyleena",
      "implanon",
      "implante (?:hormonal|contraceptivo|anticoncepcional)",
      "chip hormonal",
      "inje[çc][ãa]o (?:anticoncepcional|contraceptiva|hormonal|trimestral|mensal)",
      "adesivo (?:anticoncepcional|contraceptivo|hormonal)",
      "anel (?:vaginal|anticoncepcional|contraceptivo)",
      "nuvaring",
      "reposi[çc][ãa]o hormonal",
      "terapia hormonal",
      "tratamento hormonal",
      "trh\\b",
      "(?:valerato|hemi-?hidrato|cipionato) de estradiol",
      "estradiol (?:em gel|gel|adesivo|spray|transd[ée]rmico|oral|vaginal)",
      `${TAKEN_BEFORE}estradiol`,
      `estradiol${DOSE_AFTER}`,
      "progesterona (?:natural|micronizada|em gel|vaginal|oral)",
      "utrogestan",
      "duphaston",
      "levonorgestrel",
      "desogestrel",
      "drospirenon",
      "gestoden",
      "ciproteron",
      "dienogest",
      "noretisteron",
      "medroxiprogesteron",
      "depo[- ]?provera",
      "tibolon",
      "gestrinon",
      "(?:reposi[çc][ãa]o|gel|implante|inje[çc][ãa]o) de testosterona",
      "deposteron",
      "androgel",
      "tamoxifen",
      "anastrozol",
      "letrozol",
      "exemestan",
      "clomifen",
      "clomid\\b",
      // Thyroid.
      "levotiroxin",
      "puran\\b",
      "euthyrox",
      "synthroid",
      "levoid",
      "tapazol",
      "metimazol",
      "propiltiouracil",
      // Diabetes. "Resistência à insulina" is a lab finding, not a drug in use.
      "(?<!resist[êe]ncia (?:[àa] )?)insulina",
      "metformin",
      "glifage",
      "glibenclamid",
      "gliclazid",
      "glimepirid",
      "pioglitazon",
      "sitagliptin",
      "vildagliptin",
      "linagliptin",
      "januvia",
      "galvus",
      "empagliflozin",
      "dapagliflozin",
      "jardiance",
      "forxiga",
      "semaglutid",
      "ozempic",
      "wegovy",
      "rybelsus",
      "liraglutid",
      "victoza",
      "saxenda",
      "tirzepatid",
      "mounjaro",
      "dulaglutid",
      "trulicity",
      "hipoglicemiant",
      "antidiab[ée]tic",
      // Blood pressure and heart.
      "anti[- ]?hipertensiv",
      "losartan",
      "valsartan",
      "olmesartan",
      "candesartan",
      "telmisartan",
      "irbesartan",
      "enalapril",
      "captopril",
      "lisinopril",
      "ramipril",
      "perindopril",
      "anlodipin",
      "amlodipin",
      "nifedipin",
      "diltiazem",
      "verapamil",
      "hidroclorotiazid",
      "clortalidon",
      "indapamid",
      "furosemid",
      "lasix",
      "espironolacton",
      "aldactone",
      "atenolol",
      "propranolol",
      "metoprolol",
      "selozok",
      "carvedilol",
      "bisoprolol",
      "nebivolol",
      "clonidin",
      "metildopa",
      "digoxin",
      "amiodaron",
      // Cholesterol.
      "estatina",
      "sinvastatin",
      "atorvastatin",
      "rosuvastatin",
      "pravastatin",
      // Stomach.
      "omeprazol",
      "esomeprazol",
      "pantoprazol",
      "lansoprazol",
      "rabeprazol",
      "losec\\b",
      "nexium",
      "pantozol",
      "ranitidin",
      "famotidin",
      // Pain and inflammation. Masculine only — "dieta anti-inflamatória" is an
      // eating plan — and not after a diet noun: "alimentos anti-inflamatórios",
      // "chá anti-inflamatório", "efeito anti-inflamatório" are not a drug.
      "(?<!(?:alimentos?|ch[áa]s?|efeitos?|sucos?|temperos?)\\s)anti[- ]?inflamat[óo]rios?\\b",
      "ibuprofen",
      "diclofenac",
      "naproxen",
      "cetoprofen",
      "nimesulid",
      "meloxicam",
      "piroxicam",
      "celecoxib",
      "etoricoxib",
      "arcoxia",
      "indometacin",
      "cataflam",
      "voltaren",
      "advil",
      "alivium",
      "profenid",
      "dipiron",
      "novalgina",
      "paracetamol",
      "tylenol",
      "dorflex",
      "neosaldina",
      "buscopan",
      "sumatriptan",
      "naratriptan",
      "rizatriptan",
      "zolmitriptan",
      "corticoid",
      "prednison",
      "prednisolon",
      "dexametason",
      "betametason",
      "hidrocortison",
      "deflazacort",
      "budesonid",
      "meticorten",
      "decadron",
      "diprospan",
      "opioid",
      "tramadol",
      "tramal\\b",
      "code[íi]na",
      "tylex",
      "morfina",
      "oxicodon",
      "metadona",
      "fentanil",
      "buprenorfin",
      // Mind and sleep — never "frontal" (a brand of alprazolam, but also "dor frontal").
      "antidepress",
      "ansiol[íi]tic",
      "benzodiazep",
      "anticonvulsiv",
      "sertralin",
      "fluoxetin",
      "escitalopram",
      "citalopram",
      "paroxetin",
      "fluvoxamin",
      "venlafaxin",
      "desvenlafaxin",
      "duloxetin",
      "vortioxetin",
      "bupropion",
      "mirtazapin",
      "trazodon",
      "agomelatin",
      "amitriptilin",
      "nortriptilin",
      "clomipramin",
      "imipramin",
      "clonazepam",
      "rivotril",
      "alprazolam",
      "diazepam",
      "lorazepam",
      "bromazepam",
      "lexotan",
      "valium",
      "clobazam",
      "midazolam",
      "zolpidem",
      "stilnox",
      "zopiclon",
      "quetiapin",
      "seroquel",
      "risperidon",
      "olanzapin",
      "aripiprazol",
      "haloperidol",
      "clorpromazin",
      "levomepromazin",
      "l[íi]tio\\b",
      "valproat",
      "[áa]cido valpr",
      "depakote",
      "depakene",
      "lamotrigin",
      "carbamazepin",
      "tegretol",
      "oxcarbazepin",
      "topiramat",
      "gabapentin",
      "pregabalin",
      "lyrica",
      "fenito[íi]n",
      "hidantal",
      "fenobarbital",
      "gardenal",
      "metilfenidat",
      "ritalina",
      "lisdexanfetamin",
      "venvanse",
      // Immune system, cancer, and drugs that harm a pregnancy.
      "imunossupress",
      "quimioterap",
      "quimio\\b",
      "imunobiol[óo]gic",
      "metotrexat",
      "azatioprin",
      "ciclospor",
      "tacrolim",
      "micofenolat",
      "leflunomid",
      "hidroxicloroquin",
      "adalimumab",
      "humira",
      "infliximab",
      "etanercept",
      "rituximab",
      "tocilizumab",
      "isotretino[íi]n",
      "roacutan",
      "acitretin",
      "misoprostol",
      "cytotec",
      "finasterid",
      "dutasterid",
      "alendronat",
      // Infection, allergy, gout.
      "antibi[óo]tic",
      "amoxicilin",
      "azitromicin",
      "cefalexin",
      "ciprofloxacin",
      "levofloxacin",
      "doxiciclin",
      "metronidazol",
      "nitrofurant",
      "loratadin",
      "desloratadin",
      "cetirizin",
      "fexofenadin",
      "allegra",
      "hidroxizin",
      "prometazin",
      "alopurinol",
      "colchicin",
      // Supplements and herbal medicines with known interactions — the
      // patient's product, "fitoterápico", not the practitioner's "fitoterapia".
      "sulfato ferroso",
      "ferro quelato",
      "noripurum",
      "polivitam[íi]nic",
      "multivitam[íi]nic",
      // Taken, not measured (TAKEN_BEFORE / DOSE_AFTER): "Vitamina D3 2000 UI",
      // "toma vitamina B12" — never "vitamina D baixa no exame".
      `${TAKEN_BEFORE}vitamina (?:d3?|b ?12)\\b`,
      `vitamina (?:d3?|b ?12)\\b${DOSE_AFTER}`,
      "melatonin",
      "fitoter[áa]pic",
      "hip[ée]rico",
      "erva[- ]de[- ]s[ãa]o[- ]jo[ãa]o",
      "ginkgo",
      "ginseng",
      "valerian",
      "passiflora",
      "kava\\b",
      "canabidiol",
      "cbd\\b",
      "cannabis medicinal",
      "[óo]leo de cannabis",
    ],
  },
];

/**
 * A term must start a word — "aas" is aspirin, "baas" is nothing. `\b` cannot
 * say that in JavaScript for a word that opens with an accented letter:
 * neither the space nor the "ú" of "úlcera" is a regex word character, so
 * `\b[úu]lcera` never matched the correctly spelled word. The start is a
 * lookbehind over letters, digits and the Latin-1 accents instead.
 */
const WORD_START = "(?<![a-z0-9à-ÿ])";

const CATEGORY_PATTERNS: { category: SafetyCategory; pattern: RegExp }[] = CATEGORY_TERMS.map(
  ({ category, terms }) => ({ category, pattern: new RegExp(`${WORD_START}(?:${terms.join("|")})`, "i") }),
);

/** The union used by the anamnesis extraction to force state=attention. */
export const SENSITIVE = new RegExp(CATEGORY_PATTERNS.map((entry) => entry.pattern.source).join("|"), "i");

export interface SafetyFlag {
  category: SafetyCategory;
  /** The recorded text that triggered it (evidence, so she can check). */
  matchedText: string;
  /** Where it was recorded, when known. */
  fieldKey?: string;
}

/**
 * The word that raised a flag — what a document that LEAVES the practice may
 * show.
 *
 * `matchedText` keeps the whole recorded value, because on her screen it is
 * the evidence she checks. The printed plan the patient takes home used to copy
 * it too, so a sentence like "usa ansiolítico e fuma maconha desde os 20" came
 * out whole under "Medicamentos" — and the flags are immutable, so she could
 * not remove it. The term is the full word around the match: the pattern
 * "ansiol[íi]tic" prints as "ansiolítico", "Xarelto 20mg" as "Xarelto".
 *
 * Empty when the text no longer matches its category (an old or edited flag):
 * the document then shows the category alone.
 */
export function safetyFlagTerm(flag: { category: string; matchedText?: string | null }): string {
  const entry = CATEGORY_PATTERNS.find((candidate) => candidate.category === flag.category);
  const text = flag.matchedText ?? "";
  if (!entry || !text) return "";
  const match = new RegExp(entry.pattern.source, entry.pattern.flags.replace("g", "")).exec(text);
  if (!match) return "";
  const wordChar = /[\p{L}\p{N}-]/u;
  let start = match.index;
  let end = match.index + match[0].length;
  while (start > 0 && wordChar.test(text[start - 1])) start -= 1;
  while (end < text.length && wordChar.test(text[end])) end += 1;
  return text.slice(start, end);
}

/**
 * Fields whose every recorded value IS a medication, whatever its name: the
 * anamnesis asks there for "medicamentos e suplementos em uso". A drug the
 * patterns do not know — a new brand, a compounded formula, a misspelling — is
 * still a drug, and matching only by name let "omeprazol 20 mg em jejum" pass
 * as unremarkable, so the plan drafted for that patient carried no caution.
 */
const MEDICATION_FIELDS = new Set(["complaint.medications"]);

/**
 * A clause in a medications field that records no medication: a denial
 * ("nega", "não usa", "nada") or a note that it was not asked. Only these keep
 * the field from raising the flag — anything else written there is treated as
 * a medication. The short forms count only when they ARE the whole clause:
 * "Nada" is a denial, "Nada de remédio, só um composto" is not.
 */
const NO_MEDICATION_LINE =
  /^\s*[-–—•*]?\s*(?:nega\b|nenhum|nenhuma|n[ãa]o\s+(?:usa|toma|faz\s+uso|utiliza|informad|relatad|referid|mencionad)|sem\s+(?:uso|medica|rem[ée]dio|informa|relato)|(?:(?:paciente\s+)?neg(?:a|ou)|(?:atualmente\s+)?(?:nada|nenhum|nenhuma)(?:\s+(?:cont[íi]nuo|no\s+momento|atualmente))?|n[ãa]o(?:[,.]?\s+(?:nenhum|nenhuma|nada))?|n[ãa]o\s+est[áa]\s+(?:usando|tomando)\s+nada|nunca\s+(?:usou|tomou)|n\/a)\s*[.!]?\s*$)/i;

/** What may follow a denial in a clause of its own without naming anything taken. */
const NO_MEDICATION_TAIL =
  /^\s*(?:(?:nem|nunca|jamais)\b.*|(?:no|neste|nesse)\s+momento|por\s+(?:enquanto|ora)|atualmente|hoje)\s*$/i;

/**
 * Every CLAUSE counts, not only every line: "Nenhum contínuo, só ômega 3" and
 * "Nega. Toma cúrcuma em cápsula" open with a denial and still record a
 * product — exactly the unknown names the medications field rule exists for.
 */
const recordsMedication = (text: string) =>
  text
    .split(/\n|;|,|\.(?!\d)|\s[-–]\s|\s+(?:mas|s[óo]|apenas|somente|exceto|por[ée]m)\s+/i)
    .some((clause) => /\p{L}/u.test(clause) && !NO_MEDICATION_LINE.test(clause) && !NO_MEDICATION_TAIL.test(clause));

/**
 * Scan recorded values for sensitive factors. Deduplicated by category — one
 * pregnancy flag, not one per mention — keeping the most specific matched text.
 */
export function detectSafetyFlags(values: { text: string; fieldKey?: string }[]): SafetyFlag[] {
  const byCategory = new Map<SafetyCategory, SafetyFlag>();
  for (const { text, fieldKey } of values) {
    if (!text) continue;
    for (const { category, pattern } of CATEGORY_PATTERNS) {
      if (pattern.test(text) && !byCategory.has(category)) {
        byCategory.set(category, { category, matchedText: text.trim(), fieldKey });
      }
    }
  }
  // The medications field speaks for itself (MEDICATION_FIELDS) and, being the
  // list of what she takes, is the most specific evidence the medication flag
  // can carry — it replaces a passing mention found elsewhere in the record.
  const listed = values.find(
    ({ text, fieldKey }) => text && fieldKey && MEDICATION_FIELDS.has(fieldKey) && recordsMedication(text),
  );
  if (listed) {
    byCategory.set("medication", {
      category: "medication",
      matchedText: listed.text.trim(),
      fieldKey: listed.fieldKey,
    });
  }
  // Preserve the acuity order of CATEGORY_PATTERNS.
  return CATEGORY_PATTERNS.map((entry) => byCategory.get(entry.category)).filter((flag): flag is SafetyFlag =>
    Boolean(flag),
  );
}
