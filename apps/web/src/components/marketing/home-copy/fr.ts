import type { HomeCopy } from "./pt-BR";

/** French home copy. Typed against the pt-BR original (compile-time parity). */
export const homeCopy: HomeCopy = {
  meta: {
    title: "MedChina | Dossier clinique intelligent pour la MTC",
    description:
      "Gérez patients, anamnèses, analyses et plans thérapeutiques sur une plateforme conçue pour la médecine traditionnelle chinoise. L'IA prépare ; vous décidez.",
  },

  nav: {
    brandAria: "MedChina — accueil",
    desktopAria: "Navigation principale",
    mobileAria: "Navigation mobile",
    howItWorks: "Comment ça marche",
    features: "Fonctionnalités",
    security: "Sécurité",
    plans: "Offres",
    signIn: "Se connecter",
    signUp: "Créer un compte gratuit",
    openMenu: "Ouvrir le menu",
    closeMenu: "Fermer le menu",
  },

  language: {
    label: "Langue",
    ariaLabel: "Choisir la langue du site",
    names: {
      "pt-BR": "Português (Brasil)",
      en: "English",
      es: "Español",
      fr: "Français",
      de: "Deutsch",
      "zh-CN": "简体中文",
    },
    notice: {
      message: "Ce site s'affiche en français, d'après la langue de votre navigateur.",
      switchToDefault: "Voir en portugais",
      dismiss: "Fermer l'avis",
    },
  },

  hero: {
    eyebrow: "De la première plainte au suivi, en toute clarté",
    title: "Votre pratique de MTC,\nélargie par une IA\nque **vous supervisez.**",
    lead: "Enregistrez la consultation, structurez l'anamnèse et reliez les tableaux cliniques avec traçabilité, sans renoncer à votre décision.",
    ctaPrimary: "Créer un compte gratuit",
    ctaSecondary: "Découvrir la plateforme",
    guarantee: "14 jours gratuits, sans carte · annulez quand vous voulez",
    trustAria: "Garanties",
    trust: ["Consentement", "Traçabilité", "Contrôle clinique"],
    principle: "__L'IA organise.__\nVous interprétez, validez et décidez.",
    stageAria: "MedChina sur ordinateur et sur mobile",
    compositeAlt: "Praticienne de médecine traditionnelle chinoise utilisant MedChina sur ordinateur et sur mobile",
    platformAria: "Application disponible pour iOS et Android",
    availableFor: "Disponible pour",
    insights: [
      { title: "Information traçable", detail: "Origine et contexte conservés." },
      { title: "Hypothèse à relire", detail: "Les suggestions appellent votre jugement." },
      { title: "Plan sous votre décision", detail: "Vous fixez les conduites et les ajustements." },
    ],
  },

  valueStrip: {
    ariaLabel: "Principaux bénéfices de MedChina",
    items: [
      "Anamnèse structurée dans le langage de la MTC",
      "Modèles et plans personnalisables",
      "Évolution clinique suivie avec intelligence",
      "Sécurité et confidentialité sur tout le parcours",
    ],
  },

  flow: {
    eyebrow: "Tout le parcours, sans rupture",
    title: "Une ligne **continue** entre\nécoute, raisonnement et évolution.",
    lead: "Du premier contact au suivi, MedChina relie chaque étape de la consultation avec structure, contexte et sécurité.",
    steps: {
      consulta: {
        label: "Consultation",
        title: "La séance commence par le contexte et le consentement.",
        body: "Sélectionnez la patiente, enregistrez les autorisations et choisissez comment préparer la consultation. L'audio et les observations restent rattachés au même dossier.",
        proof: "Consentement et étape suivante visibles pendant la séance",
        alt: "Écran MedChina pour préparer l'enregistrement de la consultation et consigner le consentement",
      },
      anamnese: {
        label: "Anamnèse",
        title: "La conversation rejoint la structure clinique.",
        body: "Motif de consultation, histoire actuelle et autres champs sont réunis dans une anamnèse claire pour votre relecture — sans transformer le silence en réponse.",
        proof: "Champs structurés, modifiables et prêts à relire",
        alt: "Écran de l'anamnèse structurée dans le dossier clinique MedChina",
      },
      plano: {
        label: "Plan et évolution",
        title: "Vous validez la conduite et suivez ce qui a changé.",
        body: "Le plan thérapeutique reste modifiable et relié à l'historique. La plateforme prépare l'étape suivante ; vous relisez, ajustez et décidez.",
        proof: "Plan thérapeutique validé par la praticienne",
        alt: "Écran MedChina avec l'enregistrement de la consultation et le plan thérapeutique validé",
      },
    },
  },

  presence: {
    eyebrow: "Présence clinique",
    title: "La technologie reste en coulisses.\n**Le lien reste au centre.**",
    lead: "Une consultation de MTC demande écoute, observation et lecture individuelle. MedChina réduit la charge opérationnelle pour que vous ne relisiez que ce qui exige votre décision.",
    railLabel: "Ce qui change en pratique",
    railHint: "Parcourez les bénéfices",
    principle: "__Aucune automatisation invisible.__ La praticienne relit, ajuste et valide chaque étape.",
    benefits: [
      {
        id: "listen",
        title: "Soyez en consultation, pas dans le formulaire",
        body: "La capture mobile et les commandes vocales réduisent la saisie pendant la séance.",
      },
      {
        id: "fields",
        title: "La conversation trouve le bon champ",
        body: "Symptômes, habitudes, émotions, traitements, examens et évolution arrivent organisés pour votre relecture.",
      },
      {
        id: "history",
        title: "Voyez ce qui a changé",
        body: "Comparez les récits, les symptômes, les techniques et les réponses tout au long du suivi.",
      },
      {
        id: "hypotheses",
        title: "Des hypothèses expliquées",
        body: "En Pro, les tableaux possibles montrent signes concordants, contradictions, données manquantes et références.",
      },
      {
        id: "plan",
        title: "Du tableau au plan",
        body: "Protocoles, conseils et brouillons sont organisés sans vous faire repartir de zéro.",
      },
      {
        id: "decision",
        title: "La décision reste la vôtre",
        body: "Rien n'est finalisé automatiquement. Vous modifiez, refusez, validez et signez.",
      },
    ],
    visualAria: "Présence clinique soutenue par MedChina",
    visualAlt: "Praticienne de médecine traditionnelle chinoise écoutant une patiente pendant la consultation",
    visualTag: "La séance au premier plan",
    proofTitle: "Écoute préservée",
    proofDetail: "Moins d'écran pendant la consultation",
    focusLabel: "En avant maintenant",
    focusAiOrganizes: "L'IA organise",
    focusYouValidate: "Vous validez",
  },

  mobile: {
    eyebrow: "MedChina Mobile",
    title: "Votre mobile capte la consultation. **La plateforme organise le dossier.**",
    lead: "L'application mobile facilite l'enregistrement autorisé et la prise d'observations à la voix. Sur le web, vous relisez l'anamnèse, l'analyse et le plan thérapeutique.",
    checks: [
      "Consultations du jour et sélection sûre du patient",
      "Consentement avant d'enregistrer",
      "Mettre en pause, reprendre et consigner des observations",
      "Langue, pouls et palpation à la voix",
    ],
    offlineTitle: "Une connexion instable ne veut pas dire une consultation perdue.",
    offlineDetail: "L'audio est conservé et envoyé dès le retour de la connexion.",
    showcaseAria: "Démonstration interactive de l'application MedChina",
    deviceAlt: "Smartphone moderne avec l'application MedChina",
    platformChipAria: "Application pour iOS et Android",
    platformChipLabel: "iOS et Android",
    bubblesAria: "Points forts de l'application",
    highlights: [
      {
        id: "consent",
        label: "Consentement actif",
        title: "Enregistrement protégé",
        detail: "L'autorisation est rattachée à la consultation avant la captation.",
      },
      {
        id: "voice",
        label: "Observation vocale",
        title: "Du contexte sans saisie",
        detail: "Langue, pouls et notes cliniques s'ajoutent pendant la séance.",
      },
      {
        id: "sync",
        label: "Synchronisation sûre",
        title: "Audio préservé",
        detail: "L'envoi est confirmé avant la suppression de la copie sur l'appareil.",
      },
    ],
    phone: {
      secure: "Protégé",
      inProgress: "CONSULTATION EN COURS",
      patientName: "Helena Martins",
      patientKind: "Suivi · Acupuncture",
      patientWhen: "Aujourd'hui, 09:00 · consentement confirmé",
      recording: "ENREGISTREMENT",
      paused: "EN PAUSE",
      audioAuthorized: "Audio autorisé",
      resume: "Reprendre",
      pause: "Pause",
      noteAdded: "Note ajoutée",
      addNote: "Ajouter une note",
      noteHint: "à la voix ou au clavier",
      observation: "Langue et pouls",
      observationHint: "consigner l'observation",
      tabConsult: "Consultation",
      tabHistory: "Historique",
      tabRecord: "Dossier",
    },
  },

  supervised: {
    eyebrow: "IA supervisée",
    title: "L'anamnèse se remplit sans transformer **une absence en réponse.**",
    lead: "MedChina organise ce qui a été rapporté, conserve l'origine de chaque donnée et laisse vide ce qui n'a pas été dit.",
    conversation: {
      sourceLabel: "Source clinique",
      title: "Conversation fictive · Helena Martins",
      time: "14:32–14:46",
      quote:
        "« Je me réveille environ ==trois fois par nuit==. J'ai ==très chaud== et parfois je me réveille ==en sueur==. »",
      playAria: "Écouter l'extrait",
      pauseAria: "Mettre l'extrait en pause",
      playingLabel: "Lecture de l'extrait",
      originalLabel: "Extrait original",
      speaker: "Patiente · audio autorisé",
      duration: "0:14",
    },
    bridgeLabel: "L'IA organise",
    prepared: {
      badge: "Organisation supervisée",
      title: "Anamnèse préparée",
      summary: "3 champs organisés · aucune décision appliquée",
      reviewChip: "Relecture obligatoire",
      listen: "Écouter la source",
      noEvidence: "Aucun élément enregistré dans l'audio",
      fields: [
        {
          id: "sleep",
          label: "Sommeil",
          value: "Se réveille environ trois fois pendant la nuit.",
          state: "Élément clair",
        },
        {
          id: "evolution",
          label: "Évolution",
          value: "Fréquence rapportée ; début et évolution dans le temps encore non précisés.",
          state: "Demande attention",
        },
        {
          id: "observation",
          label: "Langue et pouls",
          value: "En attente de l'observation directe de la praticienne.",
          state: "Non renseigné",
        },
      ],
      footerTitle: "Rien n'a été finalisé automatiquement",
      footerDetail: "Vous relisez, ajustez et confirmez avant l'enregistrement au dossier.",
    },
    traceability: [
      {
        id: "origin",
        title: "Origine retrouvable",
        detail: "Chaque champ garde le lien vers l'extrait correspondant.",
      },
      {
        id: "authorship",
        title: "Paternité préservée",
        detail: "Patient, praticienne, IA et décision ne se confondent jamais.",
      },
      { id: "validation", title: "Validation explicite", detail: "Le dossier n'avance qu'après votre relecture." },
    ],
  },

  mtc: {
    eyebrow: "Spécialisation",
    title: "Un dossier construit pour la logique de la **médecine traditionnelle chinoise.**",
    lead: "Plutôt que d'adapter votre consultation à un dossier générique, MedChina organise l'évaluation selon les éléments de la pratique en MTC.",
    quote: "« Utilisez les modèles MedChina, personnalisez votre anamnèse et gardez votre façon de consulter. »",
    categories: [
      "Motif de consultation",
      "Sommeil et énergie",
      "Alimentation et digestion",
      "Émotions et contexte",
      "Yin et Yang",
      "Qi, Sang et Liquides",
      "Zang-Fu",
      "Cinq Éléments",
      "Langue",
      "Pouls",
      "Acupuncture",
      "Auriculothérapie",
    ],
  },

  security: {
    eyebrow: "Sécurité",
    title: "Les données cliniques demandent plus que du confort. **Elles demandent du contrôle.**",
    lead: "Sécurité, traçabilité et minimisation intégrées au parcours clinique — du consentement à l'historique des modifications.",
    cards: [
      {
        id: "consent",
        title: "Consentement distinct",
        body: "Enregistrement, transcription, IA et images peuvent avoir des autorisations propres et versionnées.",
      },
      {
        id: "access",
        title: "Accès protégé",
        body: "Authentification à deux facteurs, gestion des sessions, chiffrement et journaux d'accès.",
      },
      {
        id: "audio",
        title: "Audio maîtrisé",
        body: "La copie locale n'est supprimée qu'après confirmation sûre de l'envoi.",
      },
      {
        id: "history",
        title: "Historique des modifications",
        body: "Clôtures, modifications et addenda restent traçables, avec auteur, date et version.",
      },
    ],
  },

  pricing: {
    eyebrow: "Offres transparentes",
    title: "Commencez à votre rythme.\n**Automatisez quand c'est utile.**",
    lead: "Une base clinique complète pour démarrer et deux niveaux d'automatisation supervisée pour gagner du temps sans renoncer à la décision.",
    trustAria: "Conditions pour démarrer",
    trust: ["Compte gratuit pour démarrer", "Essai Pro déclenché par vous", "Sans carte ni prélèvement automatique"],
    plans: {
      gratuito: { eyebrow: "Base clinique", badge: "Commencez ici", cta: "Créer un compte gratuit" },
      assistente: {
        eyebrow: "Documentation automatique",
        badge: "Le plus choisi",
        cta: "Démarrer avec l'automatisation",
      },
      pro: { eyebrow: "Intelligence supervisée", badge: "Le plus complet", cta: "Découvrir Pro" },
    },
    defaultEyebrow: "Offre",
    defaultCta: "Créer un compte gratuit",
    offerEyebrow: "Prix de campagne",
    offerCta: "S'abonner maintenant",
    offerTitle: "Voici la condition de cette campagne.\n**Au prix de cette page, tant qu'elle est ouverte.**",
    offerLead:
      "Le compte gratuit et l'essai Pro existent toujours — ils ne sont simplement pas le chemin d'ici. Sur cette page, vous souscrivez directement au plan que vous voulez.",
    offerTrustAria: "Conditions de cette offre",
    offerTrustGuarantee: "{days} jours de garantie",
    offerTrustDeadline: "Offre valable jusqu'au {date}",
    offerAssuranceTitle: "{days} jours de garantie.",
    offerAssuranceDetail:
      "Si cela ne convient pas à votre pratique, vous demandez le remboursement sous {days} jours et récupérez votre argent.",
    included: "Ce qui est inclus",
    assuranceTitle: "L'essai commence quand le travail commence.",
    assuranceDetail:
      "L'essai Pro s'active à votre première action de travail — enregistrer, planifier, importer ou utiliser la bibliothèque — et nous vous prévenons aussitôt. Rien n'est facturé automatiquement.",
    assuranceLink: "Poser une question",
  },

  faq: {
    eyebrow: "Questions",
    title: "Questions fréquentes",
    lead: "Les réponses qui comptent sur l'offre gratuite, l'essai et le rôle de l'intelligence artificielle.",
    cta: "Commencer gratuitement",
    items: [
      {
        question: "Puis-je utiliser MedChina gratuitement ?",
        answer:
          "Oui. L'offre Gratuite permet d'enregistrer des patients, de documenter les consultations et d'utiliser les fonctions cliniques manuelles sans limite de patients ni de dossiers. Enregistrement, transcription et automatisation relèvent des offres payantes et de l'essai Pro.",
      },
      {
        question: "L'essai commence-t-il à la création du compte ?",
        answer:
          "Non. Créer le compte, configurer le profil et explorer la plateforme ne consomment rien. L'essai Pro démarre automatiquement à votre première action de travail — enregistrer une consultation, planifier un rendez-vous, importer vos dossiers ou utiliser la bibliothèque clinique — et nous vous prévenons au moment où cela arrive.",
      },
      {
        question: "Faut-il une carte bancaire pour essayer Pro ?",
        answer: "Non. L'essai n'exige aucune carte et ne déclenche aucun prélèvement.",
      },
      {
        question: "L'IA prend-elle des décisions cliniques à ma place ?",
        answer:
          "Non. L'IA organise l'information, signale les manques et, en Pro, prépare des hypothèses et des pistes thérapeutiques. La relecture, la validation et la décision finale restent à la praticienne.",
      },
      {
        question: "L'IA invente-t-elle des réponses pour les champs non évoqués ?",
        answer:
          "Ce qui n'a pas été dit reste vide — une absence ne devient jamais une négation. Les champs ambigus ou contradictoires sont signalés, et chaque information extraite peut être reliée à l'extrait de la consultation.",
      },
      {
        question: "L'application mobile remplace-t-elle la version web ?",
        answer:
          "Non. L'application est complémentaire : captation audio, commandes vocales et suivi du traitement. La relecture complète, les plans et les réglages restent sur le web.",
      },
      {
        question: "Mes données serviront-elles à entraîner des modèles publics ?",
        answer:
          "La politique de MedChina interdit l'usage d'informations cliniques pour entraîner des modèles publics. Les détails sur les prestataires, la conservation et le traitement figurent dans la documentation de confidentialité.",
      },
    ],
  },

  finalCta: {
    eyebrow: "Votre prochaine séance peut commencer autrement",
    title: "Plus de présence pour soigner. **Plus de clarté pour décider.**",
    lead: "Organisez vos patients, découvrez les fonctions cliniques et activez l'automatisation seulement quand cela a du sens pour vous.",
    ctaPrimary: "Créer mon compte gratuit",
    ctaSecondary: "Voir comment ça marche",
    bullets: ["Dossiers illimités", "Essai déclenché par vous", "Sans prélèvement automatique"],
  },

  footer: {
    tagline: "Dossier clinique et soutien au raisonnement pour la médecine traditionnelle chinoise.",
    productTitle: "Produit",
    accountTitle: "Compte",
    companyTitle: "Entreprise",
    signUp: "Commencer gratuitement",
    helpCenter: "Centre d'aide",
    about: "À propos",
    contact: "Contact",
    privacy: "Confidentialité",
    rights: "© 2026 MedChina. Tous droits réservés.",
    disclaimer:
      "MedChina ne remplace ni l'évaluation professionnelle, ni l'examen physique, ni l'observation de la langue, ni la palpation du pouls, ni l'analyse des contre-indications, ni l'orientation vers un autre professionnel si nécessaire.",
  },
};
