import type { HomeCopy } from "./pt-BR";

/**
 * English home copy. Typed against the pt-BR original, so a key that is added,
 * renamed or dropped there fails this file at compile time.
 *
 * Translated, not transliterated: the clinical-safety wording is re-stated in
 * English (the AI prepares and organizes — it never diagnoses or decides), and
 * the line breaks in headlines are chosen for THIS language.
 */
export const homeCopy: HomeCopy = {
  meta: {
    title: "MedChina | Smart clinical records for TCM",
    description:
      "Organize patients, intake, analysis and treatment plans in one platform built for Traditional Chinese Medicine. The AI prepares; you review and decide.",
  },

  nav: {
    brandAria: "MedChina — home",
    desktopAria: "Main navigation",
    mobileAria: "Mobile navigation",
    howItWorks: "How it works",
    features: "Features",
    security: "Security",
    plans: "Plans",
    signIn: "Sign in",
    signUp: "Create free account",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },

  language: {
    label: "Language",
    ariaLabel: "Choose the site language",
    names: {
      "pt-BR": "Português (Brasil)",
      en: "English",
      es: "Español",
      fr: "Français",
      de: "Deutsch",
      "zh-CN": "简体中文",
    },
    notice: {
      message: "This site is in English, chosen from your browser language.",
      switchToDefault: "View in Portuguese",
      dismiss: "Dismiss",
    },
  },

  hero: {
    eyebrow: "Clinical clarity, from the first report to the follow-up",
    title: "Your TCM practice,\nextended by an AI\n**you supervise.**",
    lead: "Record the consultation, structure the intake and connect clinical patterns with full traceability — without giving up your decision.",
    ctaPrimary: "Create free account",
    ctaSecondary: "See the platform",
    guarantee: "14 days free, no card · cancel anytime",
    trustAria: "Guarantees",
    trust: ["Consent", "Traceability", "Clinical control"],
    principle: "__The AI organizes.__\nYou interpret, validate and decide.",
    stageAria: "MedChina on desktop and mobile",
    compositeAlt: "Traditional Chinese Medicine practitioner using MedChina on a computer and a phone",
    platformAria: "App available for iOS and Android",
    availableFor: "Available for",
    insights: [
      { title: "Traceable information", detail: "Origin and context preserved." },
      { title: "Hypothesis for review", detail: "Suggestions ask for your judgement." },
      { title: "Plan under your decision", detail: "You set the treatment and the adjustments." },
    ],
  },

  valueStrip: {
    ariaLabel: "Main MedChina benefits",
    items: [
      "Intake structured in the language of TCM",
      "Templates and plans you can adapt",
      "Clinical progress followed with intelligence",
      "Security and privacy across the whole flow",
    ],
  },

  flow: {
    eyebrow: "The whole flow, without gaps",
    title: "One **continuous** line between\nlistening, reasoning and progress.",
    lead: "From the first contact to the follow-up, MedChina connects every stage of the consultation with structure, context and security.",
    steps: {
      consulta: {
        label: "Consultation",
        title: "Care starts with context and consent.",
        body: "Select the patient, record the authorizations and choose how to prepare the consultation. Audio and observations stay attached to the same record.",
        proof: "Consent and next action visible during care",
        alt: "MedChina screen for preparing the consultation recording and registering consent",
      },
      anamnese: {
        label: "Intake",
        title: "The conversation meets the clinical structure.",
        body: "Chief complaint, current history and every other field arrive gathered in a clear intake for your review — without turning silence into an answer.",
        proof: "Structured fields, editable and ready for review",
        alt: "MedChina screen showing the structured intake in the clinical record",
      },
      plano: {
        label: "Plan and progress",
        title: "You validate the treatment and follow what changed.",
        body: "The treatment plan stays editable and connected to the history. The platform prepares the next step; you review, adjust and decide.",
        proof: "Treatment plan validated by the practitioner",
        alt: "MedChina screen with the consultation recording and the validated treatment plan",
      },
    },
  },

  presence: {
    eyebrow: "Clinical presence",
    title: "The technology stays backstage.\n**The bond stays at the centre.**",
    lead: "A TCM consultation demands listening, observation and an individual reading. MedChina cuts the operational effort so you only review what needs your decision.",
    railLabel: "What changes in practice",
    railHint: "Explore the benefits",
    principle: "__No invisible automation.__ The practitioner reviews, adjusts and validates every step.",
    benefits: [
      {
        id: "listen",
        title: "Be in the consultation, not in the form",
        body: "Use mobile capture and voice commands to cut typing while you are with the patient.",
      },
      {
        id: "fields",
        title: "The conversation finds the right field",
        body: "Symptoms, habits, emotions, medication, tests and progress reach your review already organized.",
      },
      {
        id: "history",
        title: "See what changed",
        body: "Compare reports, symptoms, techniques and responses across the follow-up.",
      },
      {
        id: "hypotheses",
        title: "Hypotheses that explain themselves",
        body: "On Pro, possible patterns show supporting signs, contradictions, missing data and references.",
      },
      {
        id: "plan",
        title: "From the pattern to the plan",
        body: "Protocols, guidance and drafts are organized without making you start from scratch.",
      },
      {
        id: "decision",
        title: "The decision stays yours",
        body: "Nothing is finalized automatically. You edit, reject, validate and sign.",
      },
    ],
    visualAria: "Clinical presence supported by MedChina",
    visualAlt: "Traditional Chinese Medicine practitioner listening to a patient during the consultation",
    visualTag: "Care in focus",
    proofTitle: "Listening preserved",
    proofDetail: "Less screen during the consultation",
    focusLabel: "In focus now",
    focusAiOrganizes: "The AI organizes",
    focusYouValidate: "You validate",
  },

  mobile: {
    eyebrow: "MedChina Mobile",
    title: "Your phone captures the consultation. **The platform organizes the care.**",
    lead: "The mobile app handles authorized recording and voice observations. On the web, you review the intake, the analysis and the treatment plan.",
    checks: [
      "The day's consultations and safe patient selection",
      "Consent before recording",
      "Pause, resume and record observations",
      "Tongue, pulse and palpation by voice",
    ],
    offlineTitle: "An unstable connection does not mean a lost consultation.",
    offlineDetail: "The audio is kept and uploaded once the connection is back.",
    showcaseAria: "Interactive demo of the MedChina app",
    deviceAlt: "Modern smartphone running the MedChina app",
    platformChipAria: "App for iOS and Android",
    platformChipLabel: "iOS and Android",
    bubblesAria: "App highlights",
    highlights: [
      {
        id: "consent",
        label: "Active consent",
        title: "Protected recording",
        detail: "The authorization is attached to the consultation before capture.",
      },
      {
        id: "voice",
        label: "Voice observation",
        title: "Context without typing",
        detail: "Tongue, pulse and clinical notes go in during care.",
      },
      {
        id: "sync",
        label: "Secure sync",
        title: "Audio preserved",
        detail: "The upload is confirmed before the copy leaves the device.",
      },
    ],
    phone: {
      secure: "Protected",
      inProgress: "CONSULTATION IN PROGRESS",
      patientName: "Helena Martins",
      patientKind: "Follow-up · Acupuncture",
      patientWhen: "Today, 09:00 · consent confirmed",
      recording: "RECORDING",
      paused: "PAUSED",
      audioAuthorized: "Audio authorized",
      resume: "Resume",
      pause: "Pause",
      noteAdded: "Note added",
      addNote: "Add note",
      noteHint: "by voice or text",
      observation: "Tongue and pulse",
      observationHint: "record observation",
      tabConsult: "Consultation",
      tabHistory: "History",
      tabRecord: "Record",
    },
  },

  supervised: {
    eyebrow: "Supervised AI",
    title: "The intake is filled in without turning **absence into an answer.**",
    lead: "MedChina organizes what was reported, keeps the origin of every piece of data and leaves blank whatever was not said.",
    conversation: {
      sourceLabel: "Clinical source",
      title: "Fictional conversation · Helena Martins",
      time: "14:32–14:46",
      quote:
        "“I've been waking up about ==three times a night==. I feel ==very hot== and sometimes I wake up ==sweating==.”",
      playAria: "Play excerpt",
      pauseAria: "Pause excerpt",
      playingLabel: "Playing excerpt",
      originalLabel: "Original excerpt",
      speaker: "Patient · authorized audio",
      duration: "0:14",
    },
    bridgeLabel: "AI organizes",
    prepared: {
      badge: "Supervised organization",
      title: "Prepared intake",
      summary: "3 fields organized · no decision applied",
      reviewChip: "Review required",
      listen: "Play source",
      noEvidence: "No evidence recorded in the audio",
      fields: [
        {
          id: "sleep",
          label: "Sleep",
          value: "Wakes about three times during the night.",
          state: "Clear evidence",
        },
        {
          id: "evolution",
          label: "Progress",
          value: "Frequency reported; onset and progression over time not stated yet.",
          state: "Needs attention",
        },
        {
          id: "observation",
          label: "Tongue and pulse",
          value: "Awaiting the practitioner's direct observation.",
          state: "Not informed",
        },
      ],
      footerTitle: "Nothing was finalized automatically",
      footerDetail: "You review, adjust and confirm before it is saved to the record.",
    },
    traceability: [
      { id: "origin", title: "Origin you can recover", detail: "Every field keeps its link to the matching excerpt." },
      {
        id: "authorship",
        title: "Authorship preserved",
        detail: "Patient, practitioner, AI and decision are never mixed up.",
      },
      { id: "validation", title: "Explicit validation", detail: "The record only moves forward after your review." },
    ],
  },

  mtc: {
    eyebrow: "Specialization",
    title: "A clinical record built for the logic of **Traditional Chinese Medicine.**",
    lead: "Instead of fitting your consultation into a generic record, MedChina organizes the assessment around the elements of TCM practice.",
    quote: "“Use the MedChina templates, adapt your intake and keep your own way of practising.”",
    categories: [
      "Chief complaint",
      "Sleep and energy",
      "Diet and digestion",
      "Emotions and context",
      "Yin and Yang",
      "Qi, Blood and Fluids",
      "Zang-Fu",
      "Five Elements",
      "Tongue",
      "Pulse",
      "Acupuncture",
      "Auriculotherapy",
    ],
  },

  security: {
    eyebrow: "Security",
    title: "Clinical data demands more than convenience. **It demands control.**",
    lead: "Security, traceability and data minimization built into the clinical flow — from consent to the change history.",
    cards: [
      {
        id: "consent",
        title: "Separate consent",
        body: "Recording, transcription, AI and images can carry specific, versioned authorizations.",
      },
      {
        id: "access",
        title: "Protected access",
        body: "Two-factor authentication, session management, encryption and access logs.",
      },
      {
        id: "audio",
        title: "Audio under control",
        body: "The local copy is only removed after the upload is safely confirmed.",
      },
      {
        id: "history",
        title: "Change history",
        body: "Sign-offs, edits and addenda stay traceable, with author, date and version.",
      },
    ],
  },

  pricing: {
    eyebrow: "Transparent plans",
    title: "Start at your own pace.\n**Automate when it makes sense.**",
    lead: "A complete clinical foundation to start with, and two levels of supervised automation to save time without giving up the decision.",
    trustAria: "Conditions to start",
    trust: ["Free account to start", "Pro trial started by you", "No card, no automatic charge"],
    plans: {
      gratuito: { eyebrow: "Clinical foundation", badge: "Start here", cta: "Create free account" },
      assistente: { eyebrow: "Automatic documentation", badge: "Most chosen", cta: "Start with automation" },
      pro: { eyebrow: "Supervised intelligence", badge: "Most complete", cta: "Explore Pro" },
    },
    defaultEyebrow: "Plan",
    defaultCta: "Create free account",
    offerEyebrow: "Campaign price",
    offerCta: "Subscribe now",
    offerTitle: "This is the campaign's offer.\n**At this page's price, while it is open.**",
    offerLead:
      "The free account and the Pro trial still exist — they are simply not the path from here. On this page you subscribe straight to the plan you want.",
    offerTrustAria: "Terms of this offer",
    offerTrustGuarantee: "{days}-day money-back guarantee",
    offerTrustDeadline: "Offer valid until {date}",
    offerAssuranceTitle: "{days} days to change your mind.",
    offerAssuranceDetail:
      "If it does not fit your practice, you request a refund within {days} days and get your money back.",
    included: "What's included",
    assuranceTitle: "Your trial starts when your work starts.",
    assuranceDetail:
      "The Pro trial is activated by your first working action — recording, scheduling, importing or using the library — and we tell you the moment it happens. Nothing is charged automatically.",
    assuranceLink: "Ask a question",
  },

  faq: {
    eyebrow: "Questions",
    title: "Frequently asked questions",
    lead: "The answers that matter most about the free plan, the trial and the role of artificial intelligence.",
    cta: "Start for free",
    items: [
      {
        question: "Can I use MedChina for free?",
        answer:
          "Yes. The Free plan lets you register patients, record consultations and use the manual clinical features with no limit on patients or records. Recording, transcription and automation belong to the paid plans and the Pro trial.",
      },
      {
        question: "Does the trial start when I create my account?",
        answer:
          "No. Creating the account, setting up your profile and exploring the platform consume nothing. The Pro trial starts automatically at your first working action — recording a consultation, scheduling an appointment, importing your records or using the clinical library — and we tell you the moment it happens.",
      },
      {
        question: "Do I need a card to try Pro?",
        answer: "No. The trial requires no card and creates no automatic charge.",
      },
      {
        question: "Does the AI make clinical decisions for me?",
        answer:
          "No. The AI organizes information, points out gaps and, on Pro, prepares hypotheses and therapeutic possibilities. The review, the validation and the final decision stay with the practitioner.",
      },
      {
        question: "Does the AI invent answers for fields that were not mentioned?",
        answer:
          "Whatever was not reported stays blank — absence never becomes a denial. Ambiguous or contradictory fields are flagged, and every extracted piece of information can be traced back to its excerpt of the consultation.",
      },
      {
        question: "Does the mobile app replace the web version?",
        answer:
          "No. The app is complementary, focused on audio capture, voice commands and processing status. The full review, the plans and the settings live on the web.",
      },
      {
        question: "Will my data be used to train public models?",
        answer:
          "MedChina's policy forbids using clinical information to train public models. Details about providers, retention and processing are in the privacy documentation.",
      },
    ],
  },

  finalCta: {
    eyebrow: "Your next appointment can start differently",
    title: "More presence to care. **More clarity to decide.**",
    lead: "Organize your patients, get to know the clinical features and turn on automation only when it makes sense for you.",
    ctaPrimary: "Create my free account",
    ctaSecondary: "See how it works",
    bullets: ["Unlimited records", "Trial started by you", "No automatic charge"],
  },

  footer: {
    tagline: "Clinical records and reasoning support for Traditional Chinese Medicine.",
    productTitle: "Product",
    accountTitle: "Account",
    companyTitle: "Company",
    signUp: "Start for free",
    helpCenter: "Help centre",
    about: "About",
    contact: "Contact",
    privacy: "Privacy",
    rights: "© 2026 MedChina. All rights reserved.",
    disclaimer:
      "MedChina does not replace professional assessment, physical examination, tongue observation, pulse palpation, analysis of contraindications or referral when needed.",
  },
};
