import type { HomeCopy } from "./pt-BR";

/** German home copy. Typed against the pt-BR original (compile-time parity). */
export const homeCopy: HomeCopy = {
  meta: {
    title: "MedChina | Intelligente Patientenakte für TCM",
    description:
      "Patientinnen, Anamnese, Analyse und Therapiepläne in einer Plattform für Traditionelle Chinesische Medizin. Die KI bereitet vor; Sie prüfen und entscheiden.",
  },

  nav: {
    brandAria: "MedChina — Startseite",
    desktopAria: "Hauptnavigation",
    mobileAria: "Mobile Navigation",
    howItWorks: "So funktioniert es",
    features: "Funktionen",
    security: "Sicherheit",
    plans: "Tarife",
    signIn: "Anmelden",
    signUp: "Kostenloses Konto erstellen",
    openMenu: "Menü öffnen",
    closeMenu: "Menü schließen",
  },

  language: {
    label: "Sprache",
    ariaLabel: "Sprache der Website wählen",
    names: {
      "pt-BR": "Português (Brasil)",
      en: "English",
      es: "Español",
      fr: "Français",
      de: "Deutsch",
      "zh-CN": "简体中文",
    },
    notice: {
      message: "Diese Website erscheint auf Deutsch — gewählt anhand Ihrer Browsersprache.",
      switchToDefault: "Auf Portugiesisch ansehen",
      dismiss: "Hinweis schließen",
    },
  },

  hero: {
    eyebrow: "Klarheit von der ersten Schilderung bis zum Verlauf",
    title: "Ihre TCM-Praxis,\nerweitert um eine KI,\ndie **Sie überwachen.**",
    lead: "Dokumentieren Sie die Behandlung, strukturieren Sie die Anamnese und verbinden Sie klinische Muster nachvollziehbar — ohne Ihre Entscheidung abzugeben.",
    ctaPrimary: "Kostenloses Konto erstellen",
    ctaSecondary: "Plattform ansehen",
    guarantee: "14 Tage kostenlos, ohne Karte · jederzeit kündbar",
    trustAria: "Zusagen",
    trust: ["Einwilligung", "Nachvollziehbarkeit", "Klinische Kontrolle"],
    principle: "__Die KI ordnet.__\nSie deuten, bestätigen und entscheiden.",
    stageAria: "MedChina am Computer und am Smartphone",
    compositeAlt: "Therapeutin für Traditionelle Chinesische Medizin nutzt MedChina am Computer und am Smartphone",
    platformAria: "App für iOS und Android verfügbar",
    availableFor: "Verfügbar für",
    insights: [
      { title: "Nachvollziehbare Information", detail: "Herkunft und Kontext bleiben erhalten." },
      { title: "Hypothese zur Prüfung", detail: "Vorschläge verlangen Ihr Urteil." },
      { title: "Plan nach Ihrer Entscheidung", detail: "Sie bestimmen Vorgehen und Anpassungen." },
    ],
  },

  valueStrip: {
    ariaLabel: "Wichtigste Vorteile von MedChina",
    items: [
      "Anamnese in der Sprache der TCM strukturiert",
      "Anpassbare Vorlagen und Pläne",
      "Klinischer Verlauf intelligent begleitet",
      "Sicherheit und Datenschutz im gesamten Ablauf",
    ],
  },

  flow: {
    eyebrow: "Der ganze Ablauf, ohne Bruch",
    title: "Eine **durchgehende** Linie zwischen\nZuhören, Denken und Verlauf.",
    lead: "Vom ersten Kontakt bis zur Verlaufskontrolle verbindet MedChina jeden Schritt der Behandlung mit Struktur, Kontext und Sicherheit.",
    steps: {
      consulta: {
        label: "Behandlung",
        title: "Die Behandlung beginnt mit Kontext und Einwilligung.",
        body: "Wählen Sie die Patientin, erfassen Sie die Einwilligungen und entscheiden Sie, wie die Behandlung vorbereitet wird. Audio und Beobachtungen bleiben derselben Akte zugeordnet.",
        proof: "Einwilligung und nächster Schritt während der Behandlung sichtbar",
        alt: "MedChina-Ansicht zur Vorbereitung der Aufnahme und zur Erfassung der Einwilligung",
      },
      anamnese: {
        label: "Anamnese",
        title: "Das Gespräch trifft auf die klinische Struktur.",
        body: "Hauptbeschwerde, aktuelle Anamnese und alle weiteren Felder erscheinen gebündelt als klare Anamnese zu Ihrer Prüfung — ohne Schweigen in eine Antwort zu verwandeln.",
        proof: "Strukturierte Felder, bearbeitbar und prüfbereit",
        alt: "MedChina-Ansicht der strukturierten Anamnese in der Patientenakte",
      },
      plano: {
        label: "Plan und Verlauf",
        title: "Sie bestätigen das Vorgehen und verfolgen Veränderungen.",
        body: "Der Therapieplan bleibt bearbeitbar und mit dem Verlauf verbunden. Die Plattform bereitet den nächsten Schritt vor; Sie prüfen, passen an und entscheiden.",
        proof: "Von der Therapeutin bestätigter Therapieplan",
        alt: "MedChina-Ansicht mit Behandlungsaufnahme und bestätigtem Therapieplan",
      },
    },
  },

  presence: {
    eyebrow: "Klinische Präsenz",
    title: "Die Technik bleibt im Hintergrund.\n**Die Beziehung bleibt im Zentrum.**",
    lead: "Eine TCM-Behandlung verlangt Zuhören, Beobachten und individuelle Beurteilung. MedChina senkt den organisatorischen Aufwand, damit Sie nur prüfen, was Ihre Entscheidung braucht.",
    railLabel: "Was sich im Alltag ändert",
    railHint: "Vorteile ansehen",
    principle: "__Keine unsichtbare Automatik.__ Die Therapeutin prüft, passt an und bestätigt jeden Schritt.",
    benefits: [
      {
        id: "listen",
        title: "Seien Sie bei der Patientin, nicht im Formular",
        body: "Mobile Aufnahme und Sprachbefehle reduzieren das Tippen während der Behandlung.",
      },
      {
        id: "fields",
        title: "Das Gespräch findet das richtige Feld",
        body: "Symptome, Gewohnheiten, Emotionen, Medikamente, Befunde und Verlauf kommen geordnet zu Ihrer Prüfung.",
      },
      {
        id: "history",
        title: "Sehen, was sich verändert hat",
        body: "Vergleichen Sie Schilderungen, Symptome, Techniken und Reaktionen über den gesamten Verlauf.",
      },
      {
        id: "hypotheses",
        title: "Erklärte Hypothesen",
        body: "In Pro zeigen mögliche Muster passende Zeichen, Widersprüche, fehlende Daten und Quellen.",
      },
      {
        id: "plan",
        title: "Vom Muster zum Plan",
        body: "Protokolle, Empfehlungen und Entwürfe werden geordnet, ohne dass Sie neu anfangen müssen.",
      },
      {
        id: "decision",
        title: "Die Entscheidung bleibt bei Ihnen",
        body: "Nichts wird automatisch abgeschlossen. Sie bearbeiten, verwerfen, bestätigen und unterschreiben.",
      },
    ],
    visualAria: "Klinische Präsenz mit MedChina",
    visualAlt: "Therapeutin für Traditionelle Chinesische Medizin hört einer Patientin während der Behandlung zu",
    visualTag: "Behandlung im Fokus",
    proofTitle: "Zuhören bewahrt",
    proofDetail: "Weniger Bildschirm während der Behandlung",
    focusLabel: "Gerade im Fokus",
    focusAiOrganizes: "Die KI ordnet",
    focusYouValidate: "Sie bestätigen",
  },

  mobile: {
    eyebrow: "MedChina Mobile",
    title: "Ihr Smartphone nimmt die Behandlung auf. **Die Plattform ordnet die Dokumentation.**",
    lead: "Die mobile App erleichtert die autorisierte Aufnahme und Beobachtungen per Sprache. Im Web prüfen Sie Anamnese, Analyse und Therapieplan.",
    checks: [
      "Termine des Tages und sichere Auswahl der Patientin",
      "Einwilligung vor der Aufnahme",
      "Pausieren, fortsetzen und Beobachtungen erfassen",
      "Zunge, Puls und Palpation per Sprache",
    ],
    offlineTitle: "Eine instabile Verbindung bedeutet keine verlorene Behandlung.",
    offlineDetail: "Das Audio bleibt erhalten und wird gesendet, sobald die Verbindung zurück ist.",
    showcaseAria: "Interaktive Demo der MedChina-App",
    deviceAlt: "Modernes Smartphone mit der MedChina-App",
    platformChipAria: "App für iOS und Android",
    platformChipLabel: "iOS und Android",
    bubblesAria: "Highlights der App",
    highlights: [
      {
        id: "consent",
        label: "Einwilligung aktiv",
        title: "Geschützte Aufnahme",
        detail: "Die Einwilligung ist vor der Aufnahme mit der Behandlung verknüpft.",
      },
      {
        id: "voice",
        label: "Beobachtung per Sprache",
        title: "Kontext ohne Tippen",
        detail: "Zunge, Puls und klinische Notizen entstehen während der Behandlung.",
      },
      {
        id: "sync",
        label: "Sichere Synchronisation",
        title: "Audio bewahrt",
        detail: "Der Upload wird bestätigt, bevor die Kopie vom Gerät verschwindet.",
      },
    ],
    phone: {
      secure: "Geschützt",
      inProgress: "BEHANDLUNG LÄUFT",
      patientName: "Helena Martins",
      patientKind: "Folgetermin · Akupunktur",
      patientWhen: "Heute, 09:00 · Einwilligung bestätigt",
      recording: "AUFNAHME",
      paused: "PAUSIERT",
      audioAuthorized: "Audio autorisiert",
      resume: "Fortsetzen",
      pause: "Pausieren",
      noteAdded: "Notiz hinzugefügt",
      addNote: "Notiz hinzufügen",
      noteHint: "per Sprache oder Text",
      observation: "Zunge und Puls",
      observationHint: "Beobachtung erfassen",
      tabConsult: "Behandlung",
      tabHistory: "Verlauf",
      tabRecord: "Akte",
    },
  },

  supervised: {
    eyebrow: "Überwachte KI",
    title: "Die Anamnese wird gefüllt, ohne **Fehlen in eine Antwort** zu verwandeln.",
    lead: "MedChina ordnet das Geschilderte, bewahrt die Herkunft jeder Angabe und lässt leer, was nicht gesagt wurde.",
    conversation: {
      sourceLabel: "Klinische Quelle",
      title: "Fiktives Gespräch · Helena Martins",
      time: "14:32–14:46",
      quote:
        "„Ich wache etwa ==dreimal pro Nacht== auf. Mir ist ==sehr heiß== und manchmal wache ich ==schweißgebadet== auf.“",
      playAria: "Ausschnitt anhören",
      pauseAria: "Ausschnitt pausieren",
      playingLabel: "Ausschnitt wird abgespielt",
      originalLabel: "Originalausschnitt",
      speaker: "Patientin · autorisiertes Audio",
      duration: "0:14",
    },
    bridgeLabel: "Die KI ordnet",
    prepared: {
      badge: "Überwachte Aufbereitung",
      title: "Vorbereitete Anamnese",
      summary: "3 Felder geordnet · keine Entscheidung angewendet",
      reviewChip: "Prüfung erforderlich",
      listen: "Quelle anhören",
      noEvidence: "Kein Beleg im Audio erfasst",
      fields: [
        {
          id: "sleep",
          label: "Schlaf",
          value: "Wacht etwa dreimal pro Nacht auf.",
          state: "Klarer Beleg",
        },
        {
          id: "evolution",
          label: "Verlauf",
          value: "Häufigkeit genannt; Beginn und zeitlicher Verlauf noch nicht angegeben.",
          state: "Braucht Aufmerksamkeit",
        },
        {
          id: "observation",
          label: "Zunge und Puls",
          value: "Wartet auf die direkte Beobachtung der Therapeutin.",
          state: "Nicht angegeben",
        },
      ],
      footerTitle: "Nichts wurde automatisch abgeschlossen",
      footerDetail: "Sie prüfen, passen an und bestätigen, bevor es in die Akte kommt.",
    },
    traceability: [
      { id: "origin", title: "Herkunft auffindbar", detail: "Jedes Feld behält die Verbindung zum Ausschnitt." },
      {
        id: "authorship",
        title: "Urheberschaft bewahrt",
        detail: "Patientin, Therapeutin, KI und Entscheidung werden nie vermischt.",
      },
      { id: "validation", title: "Ausdrückliche Bestätigung", detail: "Die Akte geht erst nach Ihrer Prüfung weiter." },
    ],
  },

  mtc: {
    eyebrow: "Spezialisierung",
    title: "Eine Akte, gebaut für die Logik der **Traditionellen Chinesischen Medizin.**",
    lead: "Statt Ihre Behandlung in eine allgemeine Akte zu pressen, ordnet MedChina die Beurteilung nach den Elementen der TCM-Praxis.",
    quote:
      "„Nutzen Sie die Vorlagen von MedChina, passen Sie Ihre Anamnese an und behalten Sie Ihre Art zu behandeln.“",
    categories: [
      "Hauptbeschwerde",
      "Schlaf und Energie",
      "Ernährung und Verdauung",
      "Emotionen und Kontext",
      "Yin und Yang",
      "Qi, Blut und Säfte",
      "Zang-Fu",
      "Fünf Elemente",
      "Zunge",
      "Puls",
      "Akupunktur",
      "Ohrakupunktur",
    ],
  },

  security: {
    eyebrow: "Sicherheit",
    title: "Klinische Daten verlangen mehr als Bequemlichkeit. **Sie verlangen Kontrolle.**",
    lead: "Sicherheit, Nachvollziehbarkeit und Datensparsamkeit im klinischen Ablauf — von der Einwilligung bis zur Änderungshistorie.",
    cards: [
      {
        id: "consent",
        title: "Getrennte Einwilligung",
        body: "Aufnahme, Transkription, KI und Bilder können eigene, versionierte Einwilligungen haben.",
      },
      {
        id: "access",
        title: "Geschützter Zugang",
        body: "Zwei-Faktor-Authentifizierung, Sitzungsverwaltung, Verschlüsselung und Zugriffsprotokolle.",
      },
      {
        id: "audio",
        title: "Audio unter Kontrolle",
        body: "Die lokale Kopie wird erst nach sicherer Bestätigung des Uploads gelöscht.",
      },
      {
        id: "history",
        title: "Änderungshistorie",
        body: "Abschlüsse, Änderungen und Nachträge bleiben nachvollziehbar — mit Urheber, Datum und Version.",
      },
    ],
  },

  pricing: {
    eyebrow: "Transparente Tarife",
    title: "Beginnen Sie in Ihrem Tempo.\n**Automatisieren Sie, wenn es passt.**",
    lead: "Eine vollständige klinische Basis für den Start und zwei Stufen überwachter Automatisierung, die Zeit sparen, ohne die Entscheidung abzugeben.",
    trustAria: "Bedingungen für den Start",
    trust: ["Kostenloses Konto zum Start", "Pro-Test von Ihnen ausgelöst", "Ohne Karte und ohne Abbuchung"],
    plans: {
      gratuito: { eyebrow: "Klinische Basis", badge: "Hier beginnen", cta: "Kostenloses Konto erstellen" },
      assistente: {
        eyebrow: "Automatische Dokumentation",
        badge: "Am häufigsten gewählt",
        cta: "Mit Automatisierung starten",
      },
      pro: { eyebrow: "Überwachte Intelligenz", badge: "Am umfassendsten", cta: "Pro ansehen" },
    },
    defaultEyebrow: "Tarif",
    defaultCta: "Kostenloses Konto erstellen",
    offerEyebrow: "Aktionspreis",
    offerCta: "Jetzt abonnieren",
    offerTitle: "Das ist die Bedingung dieser Kampagne.\n**Zum Preis dieser Seite, solange sie offen ist.**",
    offerLead:
      "Das kostenlose Konto und die Pro-Testphase gibt es weiterhin — sie sind von hier aus nur nicht der Weg. Auf dieser Seite buchen Sie direkt den gewünschten Tarif.",
    offerTrustAria: "Bedingungen dieses Angebots",
    offerTrustGuarantee: "{days} Tage Geld-zurück-Garantie",
    offerTrustDeadline: "Angebot gültig bis {date}",
    offerAssuranceTitle: "{days} Tage Geld-zurück-Garantie.",
    offerAssuranceDetail:
      "Wenn es nicht zu Ihrer Praxis passt, fordern Sie innerhalb von {days} Tagen die Rückerstattung an und erhalten Ihr Geld zurück.",
    promoStripAria: "Laufende Aktion",
    promoStrip: "__{label}__ · {plan} für {price} pro Monat in den ersten {cycles} Monaten · bis {date}",
    promoStripCta: "Zum Angebot",
    promoTitle: "{label} bei MedChina.\n**{plan} für {price} pro Monat in den ersten {cycles} Monaten.**",
    promoLead:
      "Ein Angebot mit Enddatum, und der Preis jedes Monats steht am Tag des Abschlusses fest. Das kostenlose Konto gibt es weiterhin; hier abonnieren Sie direkt {plan}.",
    promoEyebrow: "{label}",
    promoDiscount: "{value} % Rabatt in den ersten {cycles} Monaten",
    promoCta: "{plan} zum {label} abonnieren",
    promoLadderTitle: "Preis jedes Monats",
    promoLadderRange: "Monate {from} bis {to}: {price} pro Monat",
    promoLadderOpen: "Ab Monat {from}: {price} pro Monat",
    promoCondition: "Heute zahlen Sie {price}. Monatlich, ohne Mindestlaufzeit: jederzeit im Konto kündbar.",
    promoCtaShort: "Zum {label}-Angebot",
    promoHeroNote: "{plan} für {price} pro Monat in den ersten {cycles} Monaten · bis {date}",
    promoFreeLink: "Noch nicht abonnieren? Kostenloses Konto erstellen",
    promoFinalEyebrow: "{label} · bis {date}",
    promoFinalTitle:
      "{plan} für {price} pro Monat in den ersten {cycles} Monaten. **Wenn es nicht passt, haben Sie {days} Tage.**",
    promoFinalBullets: [
      "{days} Tage Geld-zurück-Garantie",
      "Ohne Mindestlaufzeit: im Konto kündbar",
      "Ihre Daten jederzeit exportierbar",
    ],
    included: "Enthalten",
    assuranceTitle: "Der Test beginnt, wenn Ihre Arbeit beginnt.",
    assuranceDetail:
      "Der Pro-Test startet bei Ihrer ersten Arbeitshandlung — aufnehmen, terminieren, importieren oder die Bibliothek nutzen — und wir sagen Ihnen im selben Moment Bescheid. Es wird nichts automatisch abgebucht.",
    assuranceLink: "Fragen klären",
  },

  faq: {
    eyebrow: "Fragen",
    title: "Häufige Fragen",
    lead: "Die wichtigsten Antworten zum kostenlosen Tarif, zum Test und zur Rolle der künstlichen Intelligenz.",
    cta: "Kostenlos starten",
    items: [
      {
        question: "Kann ich MedChina kostenlos nutzen?",
        answer:
          "Ja. Der kostenlose Tarif erlaubt es, Patientinnen anzulegen, Behandlungen zu dokumentieren und die manuellen klinischen Funktionen ohne Begrenzung von Patientinnen oder Akten zu nutzen. Aufnahme, Transkription und Automatisierung gehören zu den bezahlten Tarifen und zum Pro-Test.",
      },
      {
        question: "Beginnt der Test, sobald ich ein Konto anlege?",
        answer:
          "Nein. Konto anlegen, Profil einrichten und die Plattform ansehen verbrauchen nichts. Der Pro-Test beginnt automatisch bei Ihrer ersten Arbeitshandlung — eine Behandlung aufnehmen, einen Termin planen, Ihre Akten importieren oder die klinische Bibliothek nutzen — und wir sagen Ihnen in dem Moment Bescheid.",
      },
      {
        question: "Brauche ich eine Karte, um Pro zu testen?",
        answer: "Nein. Der Test verlangt keine Karte und löst keine automatische Abbuchung aus.",
      },
      {
        question: "Trifft die KI klinische Entscheidungen für mich?",
        answer:
          "Nein. Die KI ordnet Informationen, zeigt Lücken und bereitet in Pro Hypothesen und therapeutische Möglichkeiten vor. Prüfung, Bestätigung und letzte Entscheidung bleiben bei der Therapeutin.",
      },
      {
        question: "Erfindet die KI Antworten für Felder, die nicht erwähnt wurden?",
        answer:
          "Was nicht gesagt wurde, bleibt leer — Fehlen wird nie zu einer Verneinung. Mehrdeutige oder widersprüchliche Felder werden hervorgehoben, und jede übernommene Angabe lässt sich dem Ausschnitt der Behandlung zuordnen.",
      },
      {
        question: "Ersetzt die mobile App die Webversion?",
        answer:
          "Nein. Die App ergänzt sie und konzentriert sich auf Audioaufnahme, Sprachbefehle und den Bearbeitungsstatus. Die vollständige Prüfung, die Pläne und die Einstellungen bleiben im Web.",
      },
      {
        question: "Werden meine Daten zum Training öffentlicher Modelle genutzt?",
        answer:
          "Die Richtlinie von MedChina verbietet es, klinische Informationen zum Training öffentlicher Modelle zu verwenden. Einzelheiten zu Anbietern, Aufbewahrung und Verarbeitung stehen in der Datenschutzdokumentation.",
      },
    ],
  },

  finalCta: {
    eyebrow: "Ihr nächster Termin kann anders beginnen",
    title: "Mehr Präsenz zum Behandeln. **Mehr Klarheit zum Entscheiden.**",
    lead: "Ordnen Sie Ihre Patientinnen, lernen Sie die klinischen Funktionen kennen und schalten Sie die Automatisierung erst frei, wenn es für Sie passt.",
    ctaPrimary: "Mein kostenloses Konto erstellen",
    ctaSecondary: "Ansehen, wie es funktioniert",
    bullets: ["Unbegrenzte Akten", "Test von Ihnen ausgelöst", "Keine automatische Abbuchung"],
  },

  footer: {
    tagline: "Patientenakte und Unterstützung des klinischen Denkens für Traditionelle Chinesische Medizin.",
    productTitle: "Produkt",
    accountTitle: "Konto",
    companyTitle: "Unternehmen",
    signUp: "Kostenlos starten",
    helpCenter: "Hilfebereich",
    about: "Über uns",
    contact: "Kontakt",
    privacy: "Datenschutz",
    rights: "© 2026 MedChina. Alle Rechte vorbehalten.",
    disclaimer:
      "MedChina ersetzt weder die fachliche Beurteilung noch die körperliche Untersuchung, die Zungenbeobachtung, die Pulstastung, die Prüfung von Kontraindikationen oder eine Überweisung, wenn sie nötig ist.",
  },
};
