export type GuideLanguageCode =
  | "en"
  | "sw"
  | "rn"
  | "fr"
  | "es"
  | "pt"
  | "ar"
  | "ln"
  | "rw"
  | "am";

export type GuideSection = {
  id: string;
  title: string;
  bullets: string[];
};

export type GuideFaqItem = {
  question: string;
  answer: string;
};

export type GuideContent = {
  pageTitle: string;
  pageSubtitle: string;
  languageLabel: string;
  updatedLabel: string;
  sections: GuideSection[];
  faqTitle: string;
  faq: GuideFaqItem[];
  rtl?: boolean;
  /** Shown when section/FAQ body is still English while chrome is localized. */
  translationFallbackNote?: string;
};

/** Full product name for the in-screen header (More card stays abbreviated). */
export const GUIDE_SCREEN_TITLE = "Kristo Guide";

export const GUIDE_LANGUAGES: Array<{
  code: GuideLanguageCode;
  label: string;
}> = [
  { code: "en", label: "English" },
  { code: "sw", label: "Kiswahili" },
  { code: "rn", label: "Kirundi" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "ln", label: "Lingala" },
  { code: "rw", label: "Kinyarwanda" },
  { code: "am", label: "Amharic" },
];

const EN: GuideContent = {
  pageTitle: "Kristo Guide",
  pageSubtitle: "Rules • Safety • Help — how Kristo App works for your church.",
  languageLabel: "Language",
  updatedLabel: "Last updated",
  sections: [
    {
      id: "about",
      title: "What Kristo App is",
      bullets: [
        "Kristo App is a church ecosystem for communication, media, live events, testimonies, announcements, notifications, and community life.",
        "Churches use Kristo to share truth, serve members, broadcast services, and keep a trusted spiritual home online.",
        "Every feature is designed to protect churches, pastors, members, doctrine, and trust.",
      ],
    },
    {
      id: "ai",
      title: "AI spiritual videos & audio are not allowed",
      bullets: [
        "AI spiritual videos and AI spiritual audio are not allowed inside Kristo App for preaching, prophecy, worship, testimony, or church teaching.",
        "This includes AI-generated sermons, prophecies, worship vocals, testimonies, or any fake pastor audio/video presented as real church ministry.",
        "Kristo App is not against AI in general. AI may be used outside the app or for non-church, non-doctrinal work.",
        "Inside Kristo App we restrict AI spiritual content to protect churches, members, truth, trust, and sound doctrine.",
        "If you see AI preaching, prophecy, worship, testimony, or church teaching content, report it immediately.",
      ],
    },
    {
      id: "ownership",
      title: "Church content ownership",
      bullets: [
        "When a member posts under a church, that post becomes part of that church’s community record.",
        "If the member later leaves or is removed, older posts may remain as church history and memory unless moderation removes them.",
        "Pastors and trusted hosts may review, keep, or remove content according to church policy and Kristo safety rules.",
      ],
    },
    {
      id: "reporting",
      title: "Reporting & safety",
      bullets: [
        "Report sexual content, hate speech, threats, scams, impersonation, fake miracles, fake prophecy, AI deception, violence, harassment, and harmful content.",
        "Each member may report a post once. Reports are reviewed by your church pastor and trusted media hosts in Media Studio → Reports.",
        "Some high-risk reports may automatically hide a video from the public feed while review continues. Pastors can keep or delete the content.",
        "Never use reporting to silence honest disagreement only. False Teaching reports require broader, multi-church agreement before auto-hide.",
      ],
    },
    {
      id: "subscription",
      title: "Church subscription",
      bullets: [
        "Only the Pastor/church owner pays for the church subscription. Members do not pay separately for normal church access.",
        "Members are not billed individually for announcements, testimonies, community features, or everyday church content.",
        "Subscription unlocks church media tools, live production features, and Media Studio for the church leadership team.",
      ],
    },
    {
      id: "media",
      title: "Media & trusted hosts",
      bullets: [
        "The Pastor manages church media and may appoint trusted hosts/media helpers.",
        "Trusted hosts help upload, schedule, and review media but cannot replace pastoral authority.",
        "Media reports, storage, and live tools are visible to the Pastor and approved trusted hosts.",
      ],
    },
    {
      id: "live",
      title: "Live streaming rules",
      bullets: [
        "Livestreams must be real church or ministry content — not fake, AI-generated, abusive, or misleading.",
        "Do not stream copyrighted material, impersonation, manipulation, or content that endangers members.",
        "Live rooms must honor Christ, your church, and the people watching.",
      ],
    },
    {
      id: "conduct",
      title: "Respectful conduct",
      bullets: [
        "No insults, personal attacks, bullying, or harassment of pastors, leaders, or members.",
        "No false teaching abuse, manipulation, or pressure forcing members to share, follow, or pay for blessings.",
        "Speak with grace. Disagree without destroying unity, safety, or trust.",
        "Use announcements and testimonies to build faith — not to spread fear, division, or exploitation.",
      ],
    },
  ],
  faqTitle: "Frequently asked questions",
  faq: [
    {
      question: "Can I use AI tools to edit my video before uploading?",
      answer:
        "Yes for basic editing outside spiritual deception — but do not upload AI-generated preaching, prophecy, worship vocals, or fake pastor likeness inside Kristo App.",
    },
    {
      question: "Who pays for Kristo?",
      answer:
        "Only the Pastor/church owner pays for the church subscription. Members do not pay separately for normal church access.",
    },
    {
      question: "What happens when I report a video?",
      answer:
        "Your report goes to your church’s Media Studio → Reports. Pastors and trusted hosts can keep or delete the content. High-risk patterns may temporarily hide a video from the feed during review.",
    },
    {
      question: "Do my old posts disappear if I leave the church?",
      answer:
        "Posts you shared under the church may remain as part of that church’s history unless leadership or moderation removes them.",
    },
    {
      question: "Can members manage church media?",
      answer:
        "Only the Pastor and trusted hosts appointed by the Pastor can manage Media Studio tools, hosts, and report review.",
    },
    {
      question: "Is Kristo against technology or AI?",
      answer:
        "No. Kristo restricts AI-generated spiritual content inside the app to protect doctrine and trust. AI may still be used responsibly outside the app or for non-doctrinal work.",
    },
  ],
};

const SW: GuideContent = {
  pageTitle: "Mwongozo wa Kristo",
  pageSubtitle: "Sheria • Usalama • Msaada — jinsi Kristo App inavyofanya kazi kwa kanisa lako.",
  languageLabel: "Lugha",
  updatedLabel: "Ilisasishwa",
  sections: [
    {
      id: "about",
      title: "Kristo App ni nini",
      bullets: [
        "Kristo App ni mfumo wa kanisa kwa mawasiliano, media, matukio ya moja kwa moja, ushuhuda, matangazo, arifa, na maisha ya jamii.",
        "Makanisa hutumia Kristo kushiriki ukweli, kuwahudumia waamini, kutangaza ibada, na kuweka nyumba salama ya kiroho mtandaoni.",
        "Kila kipengele kimeundwa kulinda makanisa, machungaji, waamini, mafundisho, na uaminifu.",
      ],
    },
    {
      id: "ai",
      title: "Maudhui ya kiroho yaliyotengenezwa na AI hayaruhusiwi",
      bullets: [
        "Video au sauti zilizotengenezwa na AI haziruhusiwi ndani ya Kristo App kwa mafundisho, mahubiri, unabii, ibada, ushuhuda, au maudhui mengine ya kiroho.",
        "Kristo App si dhidi ya AI kwa ujumla. AI inaweza kutumika nje ya app au kwa kazi isiyo ya mafundisho ya kanisa.",
        "Ndani ya Kristo App tunazuia maudhui ya kiroho ya AI ili kulinda makanisa, waamini, ukweli, uaminifu, na mafundisho sahihi.",
        "Ukiiona mahubiri, unabii, ibada, sauti/video bandia ya mchungaji, au maudhui ya AI ya kanisa yanayopotosha, ripoti mara moja.",
      ],
    },
    {
      id: "ownership",
      title: "Umiliki wa maudhui ya kanisa",
      bullets: [
        "Mwanachama akichapisha chini ya kanisa, chapisho hilo linakuwa sehemu ya rekodi ya jamii ya kanisa hilo.",
        "Akiondoka au kuondolewa baadaye, machapisho ya zamani yanaweza kubaki kama historia ya kanisa isipoondolewa na uongozi.",
        "Machungaji na wasaidizi wa media wanaweza kukagua, kubaki, au kuondoa maudhui kulingana na sera ya kanisa na sheria za Kristo.",
      ],
    },
    {
      id: "reporting",
      title: "Kuripoti na usalama",
      bullets: [
        "Ripoti maudhui ya ngono, chuki, vitisho, ulaghai, uigaji, miujiza bandia, unabii bandia, udanganyifu wa AI, vurugu, unyanyasaji, na maudhui hatari.",
        "Kila mwanachama anaweza kuripoti chapisho mara moja. Ripoti zinakaguliwa na mchungaji na wasaidizi wa media kwenye Media Studio → Reports.",
        "Ripoti hatari zinaweza kuficha video kwenye feed ya umma wakati ukaguzi unaendelea. Mchungaji anaweza kuweka au kufuta maudhui.",
        "Usitumie ripoti kunyamazisha tofauti ya maoni tu. Ripoti za False Teaching zinahitaji makubaliano mapana zaidi kabla ya kuficha moja kwa moja.",
      ],
    },
    {
      id: "subscription",
      title: "Usajili wa kanisa",
      bullets: [
        "Mchungaji/mmiliki wa kanisa ndiye pekee anayelipa usajili wa kanisa. Waamini hawalipiwi kando kwa ufikiaji wa kawaida wa kanisa.",
        "Waamini hawalipiwi kila mmoja kwa matangazo, ushuhuda, vipengele vya jamii, au maudhui ya kawaida ya kanisa.",
        "Usajili hufungua zana za media za kanisa, live, na Media Studio kwa uongozi wa kanisa.",
      ],
    },
    {
      id: "media",
      title: "Media na wasaidizi wa kuaminika",
      bullets: [
        "Mchungaji ana simamia media ya kanisa na anaweza kuteua wasaidizi wa media wa kuaminika.",
        "Wasaidizi husaidia kupakia, kupanga, na kukagua media lakini hawawezi kuchukua mamlaka ya kichungaji.",
        "Ripoti za media, hifadhi, na zana za live huonekana kwa Mchungaji na wasaidizi walioruhusiwa.",
      ],
    },
    {
      id: "live",
      title: "Sheria za live",
      bullets: [
        "Live lazima iwe maudhui halisi ya kanisa au huduma — si bandia, si AI, si ya unyanyasaji, wala ya kudanganya.",
        "Usitiririshi nyenzo zenye hakimiliki, uigaji, udanganyifu, au maudhui yanayowahatarisha waamini.",
        "Vyumba vya live vinapaswa kuheshimu Kristo, kanisa lako, na watazamaji.",
      ],
    },
    {
      id: "conduct",
      title: "Mwenendo wa heshima",
      bullets: [
        "Hakuna matusi, mashambulizi, unyanyasaji, au kudhalilisha machungaji, viongozi, au waamini.",
        "Hakuna unyanyasaji wa mafundisho, udanganyifu, au kulazimisha waamini kushiriki, kufuata, au kulipa kwa baraka.",
        "Ongea kwa neema. Tofautiana bila kuharibu umoja, usalama, au uaminifu.",
        "Tumia matangazo na ushuhuda kujenga imani — si kueneza hofu, mgawanyiko, au unyonyaji.",
      ],
    },
  ],
  faqTitle: "Maswali yanayoulizwa mara kwa mara",
  faq: [
    {
      question: "Naweza kutumia AI kuhariri video yangu kabla ya kupakia?",
      answer:
        "Ndiyo kwa uhariri wa kawaida — lakini usipakie mahubiri, unabii, sauti ya ibada, au sura bandia ya mchungaji iliyotengenezwa na AI ndani ya Kristo App.",
    },
    {
      question: "Nani analipa Kristo?",
      answer:
        "Mchungaji/mmiliki wa kanisa ndiye pekee anayelipa usajili wa kanisa. Waamini hawalipiwi kando kwa ufikiaji wa kawaida wa kanisa.",
    },
    {
      question: "Nini hutokea ninaporipoti video?",
      answer:
        "Ripoti yako inaenda Media Studio → Reports ya kanisa lako. Mchungaji na wasaidizi wanaweza kuweka au kufuta maudhui. Mifumo hatari inaweza kuficha video kwenye feed kwa muda.",
    },
    {
      question: "Machapisho yangu ya zamani yanaondoka nikiondoka kanisani?",
      answer:
        "Machapisho uliyoshiriki chini ya kanisa yanaweza kubaki kama historia ya kanisa isipoundolewa na uongozi.",
    },
    {
      question: "Waamini wanaweza kusimamia media ya kanisa?",
      answer:
        "Mchungaji pekee na wasaidizi wa media waliochaguliwa ndio wanaosimamia Media Studio, hosts, na ukaguzi wa ripoti.",
    },
    {
      question: "Je, Kristo ni dhidi ya teknolojia au AI?",
      answer:
        "Hapana. Kristo inazuia maudhui ya kiroho yaliyotengenezwa na AI ndani ya app ili kulinda mafundisho na uaminifu.",
    },
  ],
};

function mirrorFromEnglish(
  content: Partial<GuideContent> & Pick<GuideContent, "pageTitle" | "pageSubtitle" | "languageLabel" | "updatedLabel" | "faqTitle">
): GuideContent {
  return {
    ...EN,
    ...content,
    sections: content.sections || EN.sections,
    faq: content.faq || EN.faq,
  };
}

const RN: GuideContent = {
  pageTitle: "Ikibiriro c'Kristo",
  pageSubtitle: "Amategeko • Umutekano • Ubufasha — uko Kristo App ikora mu catora cawe.",
  languageLabel: "Ururimi",
  updatedLabel: "Vyasubiwemwo",
  faqTitle: "Ibibazo bisanzwe",
  sections: [
    {
      id: "about",
      title: "Kristo App ni iki",
      bullets: [
        "Kristo App ni ekosiste y'itorero ry'itumanaho, media, ibikorwa biri ku murongo, ubuhamya, amatangazo, amamenyesha, n'ubuzima bw'umuryango.",
        "Amatorero akoresha Kristo gusangira ukuri, gukorera abanyamuryango, no kubaka inzu y'icyizere y'umwuka kuri interineti.",
        "Buri kintu cyose cyagenewe kurinda amatorero, abayobozi, abanyamuryango, inyigisho, n'icyizere.",
      ],
    },
    {
      id: "ai",
      title: "Ibirimo by'umwuka byakozwe na AI ntibemewe",
      bullets: [
        "Amashusho cyangwa amajwi yakozwe na AI ntibemewe muri Kristo App mu kwigisha, guhubiriza, guhanura, guhimbaza, guhamya, cyangwa ibirimo by'umwuka.",
        "Kristo App si iy'kwanga AI muri rusange. AI ishobora gukoreshwa hanze y'app cyangwa mu mirimo itari y'inyigisho.",
        "Muri Kristo App dufata ingamba zo kurinda amatorero, abanyamuryango, ukuri, icyizere, n'inyigisho.",
        "Niwabona guhubiriza, guhanura, guhimbaza, cyangwa umuyobozi w'ibinyoma bya AI, menyesha ako kanya.",
      ],
    },
    {
      id: "ownership",
      title: "Uburenganzira ku birimo by'itorero",
      bullets: [
        "Umunyamuryango iyo atangaje munsi y'itorero, ico gisohoka kiba igice cy'inyandiko y'umuryango w'itorero.",
        "Niyavuye cyangwa akurwaho, ibyo yari yatanze bishobora kuguma nk'amateka y'itorero keretse ubuyobozi buhubuye.",
        "Abayobozi n'abafasha ba media bashobora gusuzuma, gusiga, cyangwa gukuraho ibirimo.",
      ],
    },
    {
      id: "reporting",
      title: "Kumenyesha no kurinda",
      bullets: [
        "Menyesha ibirimo by'ubwuzu, urwango, iterabwoba, ubujura, kwigana, ibitangaza by'ibinyoma, ubuhanuzi bw'ibinyoma, udanganya bwa AI, urwango, n'ibindi byangiza.",
        "Buri munyamuryango ashobora kumenyesha inshuro imwe. Raporo zisuzumwa muri Media Studio → Reports.",
        "Raporo zikomeye zishobora guhisha video mu feed igihe isuzuma riri gukomeza.",
        "Ntukoreshe raporo gusa kugira ngo ucice intege impaka isanzwe.",
      ],
    },
    {
      id: "subscription",
      title: "Ifatabuguzi ry'itorero",
      bullets: [
        "Umuyobozi w'itorero/nyir'itorero ni we gusa yishyura ifatabuguzi ry'itorero. Abanyamuryango ntibishyura ku giti cyabo kugira ngo babone ibirimo bisanzwe by'itorero.",
        "Abanyamuryango ntibishyurwa ku giti cyabo ku matangazo, ubuhamya, ibirimo by'umuryango, cyangwa ibirimo bisanzwe by'itorero.",
        "Ifatabuguzi ifungura ibikoresho bya media, live, na Media Studio ku buyobozi.",
      ],
    },
    {
      id: "media",
      title: "Media n'abafasha b'icyizere",
      bullets: [
        "Umuyobozi acunga media y'itorero kandi ashobora gutora abafasha b'icyizere.",
        "Abafasha bafasha kohereza no gusuzuma media batari gusimbuza ububasha bw'umuyobozi.",
        "Raporo, ububiko, na live bigaragara ku muyobozi n'abafasha bemewe.",
      ],
    },
    {
      id: "live",
      title: "Amategeko ya live",
      bullets: [
        "Live igomba kuba ibirimo nyakuri by'itorero cyangwa umurimo — si ibinyoma, si AI, si ubushotoro.",
        "Ntutere inkunga ibirimo by'uruhare, kwigana, cyangwa ibyagora abanyamuryango.",
        "Hahuba Kristo, itorero ryawe, n'abareba.",
      ],
    },
    {
      id: "conduct",
      title: "Imyitwarire y'icyubahiro",
      bullets: [
        "Nta mvumo, nta guhangana, nta gusebanya, nta gukubita abanyamuryango.",
        "Nta gukoresha inyigisho nabi, udanganya, cyangwa gutera abantu gusangira/gukurikira/kwishyura kubera imigisha.",
        "Vuga mu neza. Tandukana mu bitekerezo utacumika umwe n'icyizere.",
      ],
    },
  ],
  faq: [
    {
      question: "Nshobora gukoresha AI mu guhindura video yanjye?",
      answer:
        "Yego ku guhindura bisanzwe — ariko ntutere amajwi cyangwa amashusho ya AI y'ubuhubirizi, ubuhanuzi, cyangwa ibada muri Kristo App.",
    },
    {
      question: "Ni nde yishyura Kristo?",
      answer:
        "Umuyobozi w'itorero cyangwa nyir'itorero yishyura ifatabuguzi rimwe. Abanyamuryango ntibishyura ku giti cyabo.",
    },
    {
      question: "Ni iki kiba kiriho nmenyesheje video?",
      answer:
        "Raporo yawe igera muri Media Studio → Reports. Umuyobozi ashobora gusiga cyangwa gukuraho ibirimo.",
    },
    {
      question: "Ibyo natanze kera biragenda nse nivuye mu itorero?",
      answer: "Bishobora kuguma nk'amateka y'itorero keretse ubuyobozi buhubuye.",
    },
    {
      question: "Abanyamuryango bashobora gucunga media?",
      answer: "Umuyobozi n'abafasha ba media bemewe gusa ni bo bacunga Media Studio.",
    },
    {
      question: "Kristo irwanya AI?",
      answer:
        "Oya. Kristo irinda ibirimo by'umwuka bya AI muri app kugira ngo irinde inyigisho n'icyizere.",
    },
  ],
};

const FR = mirrorFromEnglish({
  pageTitle: "Guide Kristo",
  pageSubtitle: "Règles • Sécurité • Aide — comment Kristo App fonctionne pour votre église.",
  languageLabel: "Langue",
  updatedLabel: "Dernière mise à jour",
  faqTitle: "Questions fréquentes",
  sections: [
    {
      id: "about",
      title: "Ce qu'est Kristo App",
      bullets: [
        "Kristo App est un écosystème d'église pour la communication, les médias, le direct, les témoignages, les annonces, les notifications et la communauté.",
        "Les églises utilisent Kristo pour partager la vérité, servir les membres et garder un foyer spirituel de confiance en ligne.",
        "Chaque fonctionnalité protège les églises, les pasteurs, les membres, la doctrine et la confiance.",
      ],
    },
    {
      id: "ai",
      title: "Contenu spirituel généré par IA interdit",
      bullets: [
        "Les vidéos ou audios générés par IA ne sont pas autorisés dans Kristo App pour l'enseignement, la prédication, la prophétie, l'adoration, le témoignage ou tout contenu spirituel.",
        "Kristo App n'est pas contre l'IA en général. L'IA peut être utilisée hors de l'app ou pour un travail non doctrinal.",
        "Dans Kristo App, nous limitons le contenu spirituel IA pour protéger les églises, les membres, la vérité, la confiance et la doctrine.",
        "Si vous voyez prédication, prophétie, adoration ou pasteur faux générés par IA, signalez-le immédiatement.",
      ],
    },
    {
      id: "ownership",
      title: "Propriété du contenu de l'église",
      bullets: [
        "Quand un membre publie sous une église, la publication fait partie de l'historique communautaire de cette église.",
        "S'il part ou est retiré, d'anciennes publications peuvent rester comme mémoire de l'église sauf suppression par modération.",
        "Pasteurs et hôtes de confiance peuvent examiner, conserver ou supprimer le contenu.",
      ],
    },
    {
      id: "reporting",
      title: "Signalement et sécurité",
      bullets: [
        "Signalez contenu sexuel, haine, menaces, arnaques, usurpation, faux miracles, fausse prophétie, tromperie IA, violence, harcèlement et contenu nuisible.",
        "Chaque membre peut signaler une publication une fois. Les signalements sont examinés dans Media Studio → Reports.",
        "Certains signalements à haut risque peuvent masquer temporairement une vidéo pendant l'examen.",
        "N'utilisez pas le signalement pour faire taire un simple désaccord honnête.",
      ],
    },
    {
      id: "subscription",
      title: "Abonnement de l'église",
      bullets: [
        "Seul le pasteur ou propriétaire de l'église paie l'abonnement de l'église. Les membres ne paient pas séparément pour l'accès normal à l'église.",
        "Les membres ne sont pas facturés individuellement pour les annonces, témoignages, fonctionnalités communautaires ou contenu courant.",
        "L'abonnement débloque les outils média, le direct et Media Studio pour la direction.",
      ],
    },
    {
      id: "media",
      title: "Médias et hôtes de confiance",
      bullets: [
        "Le pasteur gère les médias de l'église et peut nommer des hôtes de confiance.",
        "Les hôtes aident à publier et réviser le contenu sans remplacer l'autorité pastorale.",
        "Rapports, stockage et live sont visibles pour le pasteur et les hôtes approuvés.",
      ],
    },
    {
      id: "live",
      title: "Règles du direct",
      bullets: [
        "Le direct doit être un vrai contenu d'église ou de ministère — pas faux, IA, abusif ou trompeur.",
        "Ne diffusez pas de contenu protégé, d'usurpation ou dangereux pour les membres.",
        "Respectez Christ, votre église et les spectateurs.",
      ],
    },
    {
      id: "conduct",
      title: "Conduite respectueuse",
      bullets: [
        "Pas d'insultes, d'attaques, de harcèlement ou de manipulation.",
        "Pas de pression pour partager, suivre ou payer pour des bénédictions.",
        "Parlez avec grâce. Désaccordez sans détruire l'unité ni la confiance.",
      ],
    },
  ],
  faq: [
    {
      question: "Puis-je utiliser l'IA pour éditer ma vidéo ?",
      answer:
        "Oui pour un montage basique — mais ne publiez pas de prédication, prophétie ou voix d'adoration générées par IA dans Kristo App.",
    },
    {
      question: "Qui paie Kristo ?",
      answer:
        "Seul le pasteur ou propriétaire de l'église paie l'abonnement de l'église. Les membres ne paient pas séparément pour l'accès normal à l'église.",
    },
    {
      question: "Que se passe-t-il quand je signale ?",
      answer:
        "Votre signalement va dans Media Studio → Reports. Le pasteur peut conserver ou supprimer le contenu.",
    },
    {
      question: "Mes anciennes publications disparaissent si je pars ?",
      answer:
        "Elles peuvent rester comme historique de l'église sauf suppression par la direction.",
    },
    {
      question: "Les membres gèrent-ils les médias ?",
      answer: "Seuls le pasteur et les hôtes de confiance nommés gèrent Media Studio.",
    },
    {
      question: "Kristo est-il contre l'IA ?",
      answer:
        "Non. Kristo limite le contenu spirituel IA dans l'app pour protéger la doctrine et la confiance.",
    },
  ],
});

const ES = mirrorFromEnglish({
  pageTitle: "Guía Kristo",
  pageSubtitle: "Reglas • Seguridad • Ayuda — cómo funciona Kristo App para tu iglesia.",
  languageLabel: "Idioma",
  updatedLabel: "Última actualización",
  faqTitle: "Preguntas frecuentes",
  sections: FR.sections.map((s, i) => ({
    ...s,
    title: [
      "Qué es Kristo App",
      "Contenido espiritual generado por IA no permitido",
      "Propiedad del contenido de la iglesia",
      "Reportes y seguridad",
      "Suscripción de la iglesia",
      "Medios y anfitriones de confianza",
      "Reglas de transmisión en vivo",
      "Conducta respetuosa",
    ][i],
    bullets: [
      [
        "Kristo App es un ecosistema de iglesia para comunicación, medios, eventos en vivo, testimonios, anuncios, notificaciones y comunidad.",
        "Las iglesias usan Kristo para compartir verdad, servir miembros y mantener un hogar espiritual confiable en línea.",
        "Cada función protege iglesias, pastores, miembros, doctrina y confianza.",
      ],
      [
        "Videos o audios generados por IA no están permitidos en Kristo App para enseñanza, predicación, profecía, adoración, testimonio u otro contenido espiritual.",
        "Kristo App no está en contra de la IA en general. La IA puede usarse fuera de la app o para trabajo no doctrinal.",
        "Dentro de Kristo App restringimos contenido espiritual de IA para proteger iglesias, miembros, verdad, confianza y doctrina.",
        "Si ves predicación, profecía, adoración o pastor falso generado por IA, repórtalo de inmediato.",
      ],
      [
        "Cuando un miembro publica bajo una iglesia, esa publicación forma parte del registro comunitario de la iglesia.",
        "Si el miembro se va o es removido, publicaciones antiguas pueden permanecer como historia de la iglesia salvo moderación.",
        "Pastores y anfitriones de confianza pueden revisar, conservar o eliminar contenido.",
      ],
      [
        "Reporta contenido sexual, odio, amenazas, estafas, suplantación, milagros falsos, profecía falsa, engaño de IA, violencia, acoso y contenido dañino.",
        "Cada miembro puede reportar una publicación una vez. Los reportes se revisan en Media Studio → Reports.",
        "Reportes de alto riesgo pueden ocultar temporalmente un video del feed durante la revisión.",
        "No uses reportes solo para silenciar desacuerdo honesto.",
      ],
      [
        "Solo una persona paga la suscripción — el Pastor o dueño de la iglesia.",
        "Los miembros no pagan individualmente por contenido normal de la iglesia.",
        "La suscripción desbloquea herramientas de medios, live y Media Studio para el liderazgo.",
      ],
      [
        "El Pastor administra los medios de la iglesia y puede nombrar anfitriones de confianza.",
        "Los anfitriones ayudan a subir y revisar medios sin reemplazar la autoridad pastoral.",
        "Reportes, almacenamiento y live son visibles para el Pastor y anfitriones aprobados.",
      ],
      [
        "Las transmisiones en vivo deben ser contenido real de iglesia o ministerio — no falso, IA, abusivo o engañoso.",
        "No transmitas material con derechos de autor, suplantación o contenido peligroso.",
        "Honra a Cristo, tu iglesia y a quienes miran.",
      ],
      [
        "Sin insultos, ataques, acoso o manipulación.",
        "Sin presionar a miembros a compartir, seguir o pagar por bendiciones.",
        "Habla con gracia. Discrepa sin destruir unidad ni confianza.",
      ],
    ][i],
  })),
  faq: FR.faq.map((item, i) => ({
    question: [
      "¿Puedo usar IA para editar mi video?",
      "¿Quién paga Kristo?",
      "¿Qué pasa cuando reporto?",
      "¿Mis publicaciones antiguas desaparecen si me voy?",
      "¿Los miembros administran medios?",
      "¿Kristo está en contra de la IA?",
    ][i],
    answer: [
      "Sí para edición básica — pero no subas predicación, profecía o voz de adoración generada por IA dentro de Kristo App.",
      "El Pastor o dueño paga una suscripción de iglesia. Los miembros no pagan individualmente.",
      "Tu reporte va a Media Studio → Reports. El Pastor puede conservar o eliminar el contenido.",
      "Pueden permanecer como historia de la iglesia salvo que liderazgo las elimine.",
      "Solo el Pastor y anfitriones de confianza administran Media Studio.",
      "No. Kristo limita contenido espiritual de IA dentro de la app para proteger doctrina y confianza.",
    ][i],
  })),
});

const PT: GuideContent = {
  pageTitle: "Guia Kristo",
  pageSubtitle: "Regras • Segurança • Ajuda — como o Kristo App funciona para sua igreja.",
  languageLabel: "Idioma",
  updatedLabel: "Última atualização",
  faqTitle: "Perguntas frequentes",
  sections: FR.sections.map((section) => ({
    ...section,
    title: section.title
      .replace("Ce qu'est Kristo App", "O que é Kristo App")
      .replace("Contenu spirituel généré par IA interdit", "Conteúdo espiritual gerado por IA não permitido")
      .replace("Propriété du contenu de l'église", "Propriedade do conteúdo da igreja")
      .replace("Signalement et sécurité", "Denúncias e segurança")
      .replace("Abonnement de l'église", "Assinatura da igreja")
      .replace("Médias et hôtes de confiance", "Mídia e anfitriões de confiança")
      .replace("Règles du direct", "Regras de transmissão ao vivo")
      .replace("Conduite respectueuse", "Conduta respeitosa"),
    bullets: section.bullets.map((line) =>
      line
        .replace(/église/g, "igreja")
        .replace(/pasteur/g, "pastor")
        .replace(/membres/g, "membros")
        .replace(/Signalez/g, "Denuncie")
    ),
  })),
  faq: FR.faq.map((item) => ({
    question: item.question
      .replace("Puis-je", "Posso")
      .replace("Qui paie", "Quem paga")
      .replace("Que se passe-t-il", "O que acontece")
      .replace("Mes anciennes", "Minhas publicações antigas")
      .replace("Les membres", "Os membros")
      .replace("Kristo est-il", "Kristo é"),
    answer: item.answer
      .replace(/pasteur/g, "pastor")
      .replace(/membres/g, "membros")
      .replace(/église/g, "igreja"),
  })),
};

const AR: GuideContent = {
  pageTitle: "دليل Kristo",
  pageSubtitle: "القواعد • السلامة • المساعدة — كيف يعمل تطبيق Kristo لكنيستك.",
  languageLabel: "اللغة",
  updatedLabel: "آخر تحديث",
  rtl: true,
  sections: [
    {
      id: "about",
      title: "ما هو تطبيق Kristo",
      bullets: [
        "Kristo App هو نظام بيئي للكنيسة للتواصل والوسائط والبث المباشر والشهادات والإعلانات والإشعارات والمجتمع.",
        "تستخدم الكنائس Kristo لمشاركة الحق وخدمة الأعضاء والحفاظ على بيت روحي موثوق عبر الإنترنت.",
        "كل ميزة مصممة لحماية الكنائس والرعاة والأعضاء والعقيدة والثقة.",
      ],
    },
    {
      id: "ai",
      title: "المحتوى الروحي المولّد بالذكاء الاصطناعي غير مسموح",
      bullets: [
        "الفيديو أو الصوت المولّد بالذكاء الاصطناعي غير مسموح داخل Kristo App للتعليم أو الوعظ أو النبوة أو العبادة أو الشهادة أو أي محتوى روحي.",
        "Kristo App ليس ضد الذكاء الاصطناعي بشكل عام. يمكن استخدامه خارج التطبيق أو لأعمال غير عقائدية.",
        "داخل Kristo App نقيّد المحتوى الروحي بالذكاء الاصطناعي لحماية الكنائس والأعضاء والحق والثقة والعقيدة.",
        "إذا رأيت وعظًا أو نبوة أو عبادة أو صوت/فيديو كاهن مزيف بالذكاء الاصطناعي، أبلغ فورًا.",
      ],
    },
    {
      id: "ownership",
      title: "ملكية محتوى الكنيسة",
      bullets: [
        "عندما ينشر عضو تحت كنيسة، يصبح المنشور جزءًا من سجل مجتمع تلك الكنيسة.",
        "إذا غادر العضو أو أُزيل، قد تبقى المنشورات القديمة كذاكرة للكنيسة ما لم تُزال بالإشراف.",
        "الرعاة والمضيفون الموثوقون يمكنهم المراجعة أو الإبقاء أو الحذف.",
      ],
    },
    {
      id: "reporting",
      title: "الإبلاغ والسلامة",
      bullets: [
        "أبلغ عن المحتوى الجنسي والكراهية والتهديدات والاحتيال وانتحال الهوية والمعجزات المزيفة والنبوة المزيفة وخداع الذكاء الاصطناعي والعنف والتحرش.",
        "يمكن لكل عضو الإبلاغ عن منشور مرة واحدة. تُراجع البلاغات في Media Studio → Reports.",
        "قد تُخفى بعض البلاغات عالية الخطورة الفيديو مؤقتًا أثناء المراجعة.",
        "لا تستخدم الإبلاغ لإسكات اختلاف صادق فقط.",
      ],
    },
    {
      id: "subscription",
      title: "اشتراك الكنيسة",
      bullets: [
        "الراعي أو مالك الكنيسة فقط يدفع اشتراك الكنيسة. الأعضاء لا يدفعون بشكل منفصل للوصول العادي إلى الكنيسة.",
        "لا يُفوتر الأعضاء كل على حدة مقابل الإعلانات أو الشهادات أو ميزات المجتمع أو المحتوى اليومي.",
        "الاشتراك يفتح أدوات الوسائط والبث المباشر وMedia Studio للقيادة.",
      ],
    },
    {
      id: "media",
      title: "الوسائط والمضيفون الموثوقون",
      bullets: [
        "الراعي يدير وسائط الكنيسة ويمكنه تعيين مضيفين موثوقين.",
        "المضيفون يساعدون في الرفع والمراجعة دون استبدال سلطة الراعي.",
        "التقارير والتخزين والبث المباشر مرئية للراعي والمضيفين المعتمدين.",
      ],
    },
    {
      id: "live",
      title: "قواعد البث المباشر",
      bullets: [
        "يجب أن يكون البث المباشر محتوى حقيقيًا للكنيسة أو الخدمة — ليس مزيفًا أو بالذكاء الاصطناعي أو مسيئًا.",
        "لا تبث مواد محمية أو انتحال هوية أو محتوى يُعرّض الأعضاء للخطر.",
        "احترم المسيح وكنيستك والمشاهدين.",
      ],
    },
    {
      id: "conduct",
      title: "السلوك المحترم",
      bullets: [
        "لا إهانات ولا هجمات ولا تنمر ولا تحرش.",
        "لا ضغط على الأعضاء للمشاركة أو المتابعة أو الدفع مقابل بركات.",
        "تحدث بنعمة. اختلف دون تدمير الوحدة أو الثقة.",
      ],
    },
  ],
  faqTitle: "أسئلة شائعة",
  faq: [
    {
      question: "هل يمكنني استخدام الذكاء الاصطناعي لتحرير الفيديو؟",
      answer:
        "نعم للتحرير الأساسي — لكن لا ترفع وعظًا أو نبوة أو صوت عبادة مولّدًا بالذكاء الاصطناعي داخل Kristo App.",
    },
    {
      question: "من يدفع Kristo؟",
      answer: "الراعي أو مالك الكنيسة يدفع اشتراكًا واحدًا. الأعضاء لا يُفوترون individually.",
    },
    {
      question: "ماذا يحدث عند الإبلاغ؟",
      answer: "يذهب بلاغك إلى Media Studio → Reports. يمكن للراعي الإبقاء أو الحذف.",
    },
    {
      question: "هل تختفي منشوراتي القديمة إذا غادرت؟",
      answer: "قد تبقى كتاريخ للكنيسة ما لم يزيلها القيادة.",
    },
    {
      question: "هل يدير الأعضاء الوسائط؟",
      answer: "الراعي والمضيفون الموثوقون فقط يديرون Media Studio.",
    },
    {
      question: "هل Kristo ضد الذكاء الاصطناعي؟",
      answer: "لا. Kristo يقيّد المحتوى الروحي بالذكاء الاصطناعي داخل التطبيق لحماية العقيدة والثقة.",
    },
  ],
};

const LN = mirrorFromEnglish({
  pageTitle: "Guide ya Kristo",
  pageSubtitle: "Mibeko • Libateli • Lisalisi — ndenge Kristo App esalaka na eglise na yo.",
  languageLabel: "Lokota",
  updatedLabel: "Ebandeli mposa",
  faqTitle: "Mituna minene",
  sections: SW.sections.map((s) => ({
    ...s,
    title: s.title.replace("Kristo App ni nini", "Kristo App ezali nini"),
  })),
  faq: SW.faq,
});

const RW = mirrorFromEnglish({
  pageTitle: "Umuyoboro wa Kristo",
  pageSubtitle: "Amategeko • Umutekano • Ubufasha — uko Kristo App ikora mu itorero ryawe.",
  languageLabel: "Ururimi",
  updatedLabel: "Byavuguruwe",
  faqTitle: "Ibibazo bisanzwe",
  sections: SW.sections,
  faq: SW.faq,
});

const AM: GuideContent = {
  pageTitle: "Kristo መመሪያ",
  pageSubtitle: "ህጎች • ደህንነት • እገዛ — Kristo App ለአደራጅትك እንዴት እንደሚሰራ።",
  languageLabel: "ቋንቋ",
  updatedLabel: "የተዘመነ",
  faqTitle: "ተደጋጋሚ ጥያቄዎች",
  sections: EN.sections,
  faq: EN.faq,
  translationFallbackNote: "Full Amharic translation coming soon.",
};

export const GUIDE_CONTENT: Record<GuideLanguageCode, GuideContent> = {
  en: EN,
  sw: SW,
  rn: RN,
  fr: FR,
  es: ES,
  pt: PT,
  ar: AR,
  ln: LN,
  rw: RW,
  am: AM,
};

export const GUIDE_LAST_UPDATED = "June 2026";
