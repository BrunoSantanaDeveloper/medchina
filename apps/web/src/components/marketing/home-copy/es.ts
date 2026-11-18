import type { HomeCopy } from "./pt-BR";

/** Spanish home copy. Typed against the pt-BR original (compile-time parity). */
export const homeCopy: HomeCopy = {
  meta: {
    title: "MedChina | Historia clínica inteligente para MTC",
    description:
      "Organiza pacientes, anamnesis, análisis y planes terapéuticos en una plataforma hecha para Medicina Tradicional China. La IA prepara; tú revisas y decides.",
  },

  nav: {
    brandAria: "MedChina — inicio",
    desktopAria: "Navegación principal",
    mobileAria: "Navegación móvil",
    howItWorks: "Cómo funciona",
    features: "Recursos",
    security: "Seguridad",
    plans: "Planes",
    signIn: "Entrar",
    signUp: "Crear cuenta gratis",
    openMenu: "Abrir menú",
    closeMenu: "Cerrar menú",
  },

  language: {
    label: "Idioma",
    ariaLabel: "Elegir el idioma del sitio",
    names: {
      "pt-BR": "Português (Brasil)",
      en: "English",
      es: "Español",
      fr: "Français",
      de: "Deutsch",
      "zh-CN": "简体中文",
    },
    notice: {
      message: "Este sitio está en español, elegido según el idioma de tu navegador.",
      switchToDefault: "Ver en portugués",
      dismiss: "Cerrar aviso",
    },
  },

  hero: {
    eyebrow: "Claridad clínica, del primer relato al seguimiento",
    title: "Tu práctica de MTC,\nampliada por una IA\nque **tú supervisas.**",
    lead: "Registra la consulta, estructura la anamnesis y conecta patrones clínicos con trazabilidad, sin renunciar a tu decisión.",
    ctaPrimary: "Crear cuenta gratuita",
    ctaSecondary: "Conocer la plataforma",
    guarantee: "14 días gratis, sin tarjeta · cancela cuando quieras",
    trustAria: "Garantías",
    trust: ["Consentimiento", "Trazabilidad", "Control clínico"],
    principle: "__La IA organiza.__\nTú interpretas, validas y decides.",
    stageAria: "MedChina en el ordenador y en el móvil",
    compositeAlt: "Profesional de Medicina Tradicional China usando MedChina en el ordenador y en el móvil",
    platformAria: "Aplicación disponible para iOS y Android",
    availableFor: "Disponible para",
    insights: [
      { title: "Información trazable", detail: "Origen y contexto preservados." },
      { title: "Hipótesis para revisar", detail: "Las sugerencias piden tu criterio." },
      { title: "Plan bajo tu decisión", detail: "Tú defines las conductas y los ajustes." },
    ],
  },

  valueStrip: {
    ariaLabel: "Principales beneficios de MedChina",
    items: [
      "Anamnesis estructurada en el lenguaje de la MTC",
      "Plantillas y planes personalizables",
      "Evolución clínica acompañada con inteligencia",
      "Seguridad y privacidad en todo el flujo",
    ],
  },

  flow: {
    eyebrow: "Todo el flujo, con continuidad",
    title: "Una línea **continua** entre\nescucha, razonamiento y evolución.",
    lead: "Del primer contacto al seguimiento, MedChina conecta cada etapa de la consulta con estructura, contexto y seguridad.",
    steps: {
      consulta: {
        label: "Consulta",
        title: "La atención empieza con contexto y consentimiento.",
        body: "Selecciona a la paciente, registra las autorizaciones y elige cómo preparar la consulta. El audio y las observaciones quedan asociados a la misma historia clínica.",
        proof: "Consentimiento y próximo paso visibles durante la atención",
        alt: "Pantalla de MedChina para preparar la grabación de la consulta y registrar el consentimiento",
      },
      anamnese: {
        label: "Anamnesis",
        title: "La conversación encuentra la estructura clínica.",
        body: "Motivo de consulta, historia actual y los demás campos quedan reunidos en una anamnesis clara para tu revisión — sin convertir el silencio en respuesta.",
        proof: "Campos estructurados, editables y listos para revisar",
        alt: "Pantalla de la anamnesis estructurada en la historia clínica de MedChina",
      },
      plano: {
        label: "Plan y evolución",
        title: "Tú validas la conducta y sigues lo que cambió.",
        body: "El plan terapéutico sigue siendo editable y conectado al historial. La plataforma prepara el siguiente paso; tú revisas, ajustas y decides.",
        proof: "Plan terapéutico validado por la profesional",
        alt: "Pantalla de MedChina con la grabación de la consulta y el plan terapéutico validado",
      },
    },
  },

  presence: {
    eyebrow: "Presencia clínica",
    title: "La tecnología queda entre bastidores.\n**El vínculo sigue en el centro.**",
    lead: "La consulta en MTC exige escucha, observación y lectura individual. MedChina reduce el esfuerzo operativo para que revises solo lo que exige tu decisión.",
    railLabel: "Lo que cambia en la práctica",
    railHint: "Explora los beneficios",
    principle: "__Sin automatización invisible.__ La profesional revisa, ajusta y valida cada etapa.",
    benefits: [
      {
        id: "listen",
        title: "Estate en la consulta, no en el formulario",
        body: "Usa la captación móvil y los comandos de voz para escribir menos durante la atención.",
      },
      {
        id: "fields",
        title: "La conversación encuentra el campo correcto",
        body: "Síntomas, hábitos, emociones, medicación, pruebas y evolución llegan organizados a tu revisión.",
      },
      {
        id: "history",
        title: "Mira lo que cambió",
        body: "Compara relatos, síntomas, técnicas y respuestas a lo largo del seguimiento.",
      },
      {
        id: "hypotheses",
        title: "Hipótesis explicadas",
        body: "En Pro, los patrones posibles muestran signos a favor, contradicciones, datos ausentes y referencias.",
      },
      {
        id: "plan",
        title: "Del patrón al plan",
        body: "Protocolos, indicaciones y borradores se organizan sin hacerte empezar de cero.",
      },
      {
        id: "decision",
        title: "La decisión sigue siendo tuya",
        body: "Nada se finaliza automáticamente. Tú editas, rechazas, validas y firmas.",
      },
    ],
    visualAria: "Presencia clínica apoyada por MedChina",
    visualAlt: "Profesional de Medicina Tradicional China escuchando a una paciente durante la consulta",
    visualTag: "Atención en foco",
    proofTitle: "Escucha preservada",
    proofDetail: "Menos pantalla durante la consulta",
    focusLabel: "En foco ahora",
    focusAiOrganizes: "La IA organiza",
    focusYouValidate: "Tú validas",
  },

  mobile: {
    eyebrow: "MedChina Mobile",
    title: "Tu móvil capta la consulta. **La plataforma organiza la atención.**",
    lead: "La aplicación móvil facilita la grabación autorizada y el registro de observaciones por voz. En la web revisas la anamnesis, el análisis y el plan terapéutico.",
    checks: [
      "Consultas del día y selección segura del paciente",
      "Consentimiento antes de grabar",
      "Pausar, reanudar y registrar observaciones",
      "Lengua, pulso y palpación por voz",
    ],
    offlineTitle: "Una conexión inestable no significa una consulta perdida.",
    offlineDetail: "El audio se conserva y se envía cuando vuelve la conexión.",
    showcaseAria: "Demostración interactiva de la aplicación MedChina",
    deviceAlt: "Teléfono moderno con la aplicación MedChina",
    platformChipAria: "Aplicación para iOS y Android",
    platformChipLabel: "iOS y Android",
    bubblesAria: "Destacados de la aplicación",
    highlights: [
      {
        id: "consent",
        label: "Consentimiento activo",
        title: "Grabación protegida",
        detail: "La autorización queda vinculada a la consulta antes de la captación.",
      },
      {
        id: "voice",
        label: "Observación por voz",
        title: "Contexto sin escribir",
        detail: "Lengua, pulso y notas clínicas entran durante la atención.",
      },
      {
        id: "sync",
        label: "Sincronización segura",
        title: "Audio preservado",
        detail: "El envío se confirma antes de borrar la copia del dispositivo.",
      },
    ],
    phone: {
      secure: "Protegido",
      inProgress: "CONSULTA EN CURSO",
      patientName: "Helena Martins",
      patientKind: "Seguimiento · Acupuntura",
      patientWhen: "Hoy, 09:00 · consentimiento confirmado",
      recording: "GRABANDO",
      paused: "EN PAUSA",
      audioAuthorized: "Audio autorizado",
      resume: "Reanudar",
      pause: "Pausar",
      noteAdded: "Nota añadida",
      addNote: "Añadir nota",
      noteHint: "por voz o texto",
      observation: "Lengua y pulso",
      observationHint: "registrar observación",
      tabConsult: "Consulta",
      tabHistory: "Historial",
      tabRecord: "Historia clínica",
    },
  },

  supervised: {
    eyebrow: "IA supervisada",
    title: "La anamnesis se completa sin convertir **ausencia en respuesta.**",
    lead: "MedChina organiza la información relatada, preserva el origen de cada dato y deja en blanco lo que no se informó.",
    conversation: {
      sourceLabel: "Fuente clínica",
      title: "Conversación ficticia · Helena Martins",
      time: "14:32–14:46",
      quote:
        "“Me despierto unas ==tres veces por la noche==. Siento ==mucho calor== y a veces me despierto ==sudando==.”",
      playAria: "Escuchar fragmento",
      pauseAria: "Pausar fragmento",
      playingLabel: "Reproduciendo fragmento",
      originalLabel: "Fragmento original",
      speaker: "Paciente · audio autorizado",
      duration: "0:14",
    },
    bridgeLabel: "La IA organiza",
    prepared: {
      badge: "Organización supervisada",
      title: "Anamnesis preparada",
      summary: "3 campos organizados · ninguna decisión aplicada",
      reviewChip: "Revisión obligatoria",
      listen: "Escuchar origen",
      noEvidence: "Sin evidencia registrada en el audio",
      fields: [
        {
          id: "sleep",
          label: "Sueño",
          value: "Se despierta aproximadamente tres veces durante la noche.",
          state: "Evidencia clara",
        },
        {
          id: "evolution",
          label: "Evolución",
          value: "Frecuencia relatada; inicio y evolución temporal aún no informados.",
          state: "Requiere atención",
        },
        {
          id: "observation",
          label: "Lengua y pulso",
          value: "A la espera de la observación directa de la profesional.",
          state: "No informado",
        },
      ],
      footerTitle: "Nada se finalizó automáticamente",
      footerDetail: "Tú revisas, ajustas y confirmas antes de guardar en la historia clínica.",
    },
    traceability: [
      { id: "origin", title: "Origen recuperable", detail: "Cada campo mantiene el vínculo con su fragmento." },
      {
        id: "authorship",
        title: "Autoría preservada",
        detail: "Paciente, profesional, IA y decisión nunca se confunden.",
      },
      { id: "validation", title: "Validación explícita", detail: "La historia solo avanza después de tu revisión." },
    ],
  },

  mtc: {
    eyebrow: "Especialización",
    title: "Una historia clínica construida para la lógica de la **Medicina Tradicional China.**",
    lead: "En vez de adaptar tu consulta a una historia genérica, MedChina organiza la evaluación según los elementos de la práctica de la MTC.",
    quote: "“Usa las plantillas de MedChina, personaliza tu anamnesis y mantén tu propia forma de atender.”",
    categories: [
      "Motivo de consulta",
      "Sueño y energía",
      "Alimentación y digestión",
      "Emociones y contexto",
      "Yin y Yang",
      "Qi, Sangre y Líquidos",
      "Zang-Fu",
      "Cinco Elementos",
      "Lengua",
      "Pulso",
      "Acupuntura",
      "Auriculoterapia",
    ],
  },

  security: {
    eyebrow: "Seguridad",
    title: "Los datos clínicos exigen más que comodidad. **Exigen control.**",
    lead: "Seguridad, trazabilidad y minimización integradas al flujo clínico — del consentimiento al historial de cambios.",
    cards: [
      {
        id: "consent",
        title: "Consentimiento separado",
        body: "Grabación, transcripción, IA e imágenes pueden tener autorizaciones específicas y versionadas.",
      },
      {
        id: "access",
        title: "Acceso protegido",
        body: "Autenticación en dos factores, gestión de sesiones, cifrado y registros de acceso.",
      },
      {
        id: "audio",
        title: "Audio bajo control",
        body: "La copia local solo se elimina tras la confirmación segura del envío.",
      },
      {
        id: "history",
        title: "Historial de cambios",
        body: "Cierres, ediciones y anexos quedan trazables, con autoría, fecha y versión.",
      },
    ],
  },

  pricing: {
    eyebrow: "Planes transparentes",
    title: "Empieza a tu ritmo.\n**Automatiza cuando tenga sentido.**",
    lead: "Una base clínica completa para empezar y dos niveles de automatización supervisada para ganar tiempo sin renunciar a la decisión.",
    trustAria: "Condiciones para empezar",
    trust: ["Cuenta gratuita para empezar", "Prueba Pro iniciada por ti", "Sin tarjeta ni cobro automático"],
    plans: {
      gratuito: { eyebrow: "Base clínica", badge: "Empieza aquí", cta: "Crear cuenta gratis" },
      assistente: { eyebrow: "Documentación automática", badge: "El más elegido", cta: "Empezar con automatización" },
      pro: { eyebrow: "Inteligencia supervisada", badge: "El más completo", cta: "Conocer Pro" },
    },
    defaultEyebrow: "Plan",
    defaultCta: "Crear cuenta gratis",
    offerEyebrow: "Precio de campaña",
    offerCta: "Suscribirme ahora",
    offerTitle: "Esta es la condición de la campaña.\n**Al precio de esta página, mientras esté abierta.**",
    offerLead:
      "La cuenta gratuita y la prueba del Pro siguen existiendo: solo no son el camino desde aquí. En esta página te suscribes directamente al plan que quieres.",
    offerTrustAria: "Condiciones de esta oferta",
    offerTrustGuarantee: "{days} días de garantía",
    offerTrustDeadline: "Condición válida hasta {date}",
    offerAssuranceTitle: "{days} días de garantía.",
    offerAssuranceDetail:
      "Si no encaja en tu práctica, pides el reembolso en un plazo de {days} días y recuperas el importe.",
    promoStripAria: "Promoción en curso",
    promoStrip: "__{label}__ · {plan} a {price} al mes los primeros {cycles} meses · hasta el {date}",
    promoStripCta: "Ver la oferta",
    promoTitle: "{label} en MedChina.\n**{plan} a {price} al mes los primeros {cycles} meses.**",
    promoLead:
      "Una condición con fecha de fin y con el precio de cada mes definido el día en que te suscribes. La cuenta gratuita sigue existiendo; aquí te suscribes directamente a {plan}.",
    promoEyebrow: "{label}",
    promoDiscount: "{value}% de descuento los primeros {cycles} meses",
    promoCta: "Suscribirme a {plan} en {label}",
    promoLadderTitle: "Precio de cada mes",
    promoLadderRange: "Meses {from} a {to}: {price} al mes",
    promoLadderOpen: "Desde el mes {from}: {price} al mes",
    promoCondition: "Hoy pagas {price}. Mensual, sin permanencia: cancela cuando quieras desde el panel.",
    included: "Qué incluye",
    assuranceTitle: "Empiezas a probar cuando empiezas a trabajar.",
    assuranceDetail:
      "La prueba Pro se activa en tu primera acción de trabajo — grabar, agendar, importar o usar la biblioteca — y te avisamos en el momento. No se cobra nada automáticamente.",
    assuranceLink: "Resolver dudas",
  },

  faq: {
    eyebrow: "Dudas",
    title: "Preguntas frecuentes",
    lead: "Las respuestas más importantes sobre el plan gratuito, la prueba y el papel de la inteligencia artificial.",
    cta: "Empezar gratis",
    items: [
      {
        question: "¿Puedo usar MedChina gratis?",
        answer:
          "Sí. El plan Gratuito permite registrar pacientes, documentar consultas y usar los recursos clínicos manuales sin límite de pacientes ni de historias. La grabación, la transcripción y la automatización forman parte de los planes de pago y de la prueba Pro.",
      },
      {
        question: "¿La prueba empieza cuando creo mi cuenta?",
        answer:
          "No. Crear la cuenta, configurar el perfil y explorar la plataforma no consumen nada. La prueba Pro empieza automáticamente en tu primera acción de trabajo — grabar una consulta, agendar una atención, importar tus historias o usar la biblioteca clínica — y te avisamos en el momento en que ocurre.",
      },
      {
        question: "¿Necesito registrar una tarjeta para probar Pro?",
        answer: "No. La prueba no exige tarjeta ni genera cobro automático.",
      },
      {
        question: "¿La IA toma decisiones clínicas por mí?",
        answer:
          "No. La IA organiza información, señala vacíos y, en Pro, prepara hipótesis y posibilidades terapéuticas. La revisión, la validación y la decisión final siguen siendo de la profesional.",
      },
      {
        question: "¿La IA inventa respuestas para campos no mencionados?",
        answer:
          "Lo que no se informó queda en blanco — la ausencia nunca se convierte en negación. Los campos ambiguos o contradictorios se destacan, y cada dato extraído puede relacionarse con el fragmento de la consulta.",
      },
      {
        question: "¿La aplicación móvil sustituye a la versión web?",
        answer:
          "No. La aplicación es complementaria y se centra en la captación de audio, los comandos por voz y el seguimiento del procesamiento. La revisión completa, los planes y los ajustes están en la web.",
      },
      {
        question: "¿Mis datos se usarán para entrenar modelos públicos?",
        answer:
          "La política de MedChina prohíbe el uso de información clínica para entrenar modelos públicos. Los detalles sobre proveedores, retención y tratamiento están en la documentación de privacidad.",
      },
    ],
  },

  finalCta: {
    eyebrow: "Tu próxima atención puede empezar distinta",
    title: "Más presencia para cuidar. **Más claridad para decidir.**",
    lead: "Organiza a tus pacientes, conoce los recursos clínicos y activa la automatización solo cuando tenga sentido para ti.",
    ctaPrimary: "Crear mi cuenta gratuita",
    ctaSecondary: "Ver cómo funciona",
    bullets: ["Historias ilimitadas", "Prueba iniciada por ti", "Sin cobro automático"],
  },

  footer: {
    tagline: "Historia clínica y apoyo al razonamiento clínico para Medicina Tradicional China.",
    productTitle: "Producto",
    accountTitle: "Cuenta",
    companyTitle: "Empresa",
    signUp: "Empezar gratis",
    helpCenter: "Centro de ayuda",
    about: "Sobre nosotros",
    contact: "Contacto",
    privacy: "Privacidad",
    rights: "© 2026 MedChina. Todos los derechos reservados.",
    disclaimer:
      "MedChina no sustituye la evaluación profesional, la exploración física, la observación de la lengua, la palpación del pulso, el análisis de contraindicaciones ni la derivación cuando sea necesaria.",
  },
};
