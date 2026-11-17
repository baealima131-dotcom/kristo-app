import type { TermsLocale } from "./types";

/**
 * Short summary shown on the consent screen before acceptance. It only restates the full Terms
 * (the 23 sections in each locale file, opened with "Read full terms"); it adds no new terms, so
 * TERMS_VERSION is unchanged.
 */
export type TermsSummaryPoint = { title: string; text: string };

export type TermsSummary = {
  intro: string;
  points: TermsSummaryPoint[];
  readFullTermsLabel: string;
  closeLabel: string;
};

export const TERMS_SUMMARY_POINT_COUNT = 5;

export const TERMS_SUMMARIES: Record<TermsLocale, TermsSummary> = {
  en: {
    intro: "By continuing, you agree to the Kristo App Terms of Use and Community Guidelines. The key points:",
    points: [
      {
        title: "Your account",
        text: "Use true information, keep your password safe, and never impersonate anyone or claim authority you don't have.",
      },
      {
        title: "Prohibited content",
        text: "Zero tolerance for harassment, hate, threats, sexual or violent content, scams, spam, illegal content, copyright abuse, and fake AI content presented as real. You are responsible for what you post.",
      },
      {
        title: "Church permissions",
        text: "What you can post depends on your role. Your Pastor and church leaders may review, limit, or remove content in church spaces, but church rules can't allow what Kristo App or the law forbids.",
      },
      {
        title: "Safety",
        text: "Report harmful content and block abusive users in the app; safety reports are reviewed first. Anything that harms or exploits children is strictly forbidden.",
      },
      {
        title: "Enforcement",
        text: "Violations can lead to content removal, warnings, limited features, or account suspension or termination. You can request a review through Support.",
      },
    ],
    readFullTermsLabel: "Read full terms",
    closeLabel: "Close",
  },
  sw: {
    intro: "Kwa kuendelea, unakubali Masharti ya Matumizi na Miongozo ya Jamii ya Kristo App. Mambo muhimu:",
    points: [
      {
        title: "Akaunti yako",
        text: "Tumia taarifa za kweli, linda nenosiri lako, na usijifanye mtu mwingine wala kudai mamlaka usiyo nayo.",
      },
      {
        title: "Maudhui yanayokatazwa",
        text: "Hakuna uvumilivu kwa unyanyasaji, chuki, vitisho, maudhui ya ngono au vurugu, utapeli, spam, maudhui haramu, ukiukaji wa hakimiliki, na maudhui ya AI ya uongo yanayoonyeshwa kama halisi. Unawajibika kwa unachochapisha.",
      },
      {
        title: "Ruhusa za kanisa",
        text: "Unachoweza kuchapisha kinategemea jukumu lako. Pastor na viongozi wa kanisa wanaweza kukagua, kuzuia au kuondoa maudhui kwenye maeneo ya kanisa, lakini sheria za kanisa haziwezi kuruhusu kilichokatazwa na Kristo App au sheria.",
      },
      {
        title: "Usalama",
        text: "Ripoti maudhui hatari na umzuie mtumiaji mnyanyasaji ndani ya app; ripoti za usalama hukaguliwa kwanza. Chochote kinachowadhuru au kuwanyonya watoto kimekatazwa kabisa.",
      },
      {
        title: "Hatua za usimamizi",
        text: "Ukiukaji unaweza kusababisha maudhui kuondolewa, onyo, kuzuiwa baadhi ya huduma, au akaunti kusimamishwa au kufutwa. Unaweza kuomba ukaguzi upya kupitia Support.",
      },
    ],
    readFullTermsLabel: "Soma masharti yote",
    closeLabel: "Funga",
  },
  fr: {
    intro: "En continuant, vous acceptez les Conditions d'utilisation et les Règles de la communauté de Kristo App. L'essentiel :",
    points: [
      {
        title: "Votre compte",
        text: "Donnez des informations exactes, protégez votre mot de passe et n'usurpez jamais l'identité de quelqu'un ni une autorité que vous n'avez pas.",
      },
      {
        title: "Contenus interdits",
        text: "Tolérance zéro pour le harcèlement, la haine, les menaces, les contenus sexuels ou violents, les arnaques, le spam, les contenus illégaux, les violations du droit d'auteur et les faux contenus d'IA présentés comme réels. Vous êtes responsable de ce que vous publiez.",
      },
      {
        title: "Permissions de l'église",
        text: "Ce que vous pouvez publier dépend de votre rôle. Le Pasteur et les responsables de l'église peuvent examiner, limiter ou retirer des contenus dans les espaces de l'église, mais les règles de l'église ne peuvent pas autoriser ce que Kristo App ou la loi interdit.",
      },
      {
        title: "Sécurité",
        text: "Signalez les contenus nuisibles et bloquez les utilisateurs abusifs dans l'app ; les signalements de sécurité sont traités en priorité. Tout ce qui nuit aux enfants ou les exploite est strictement interdit.",
      },
      {
        title: "Mesures de modération",
        text: "Les infractions peuvent entraîner le retrait de contenus, des avertissements, des fonctions limitées, ou la suspension ou la suppression du compte. Vous pouvez demander un réexamen via le Support.",
      },
    ],
    readFullTermsLabel: "Lire les conditions complètes",
    closeLabel: "Fermer",
  },
  es: {
    intro: "Al continuar, aceptas los Términos de uso y las Normas de la comunidad de Kristo App. Lo esencial:",
    points: [
      {
        title: "Tu cuenta",
        text: "Usa información verdadera, protege tu contraseña y nunca suplantes a nadie ni afirmes una autoridad que no tienes.",
      },
      {
        title: "Contenido prohibido",
        text: "Tolerancia cero con el acoso, el odio, las amenazas, el contenido sexual o violento, las estafas, el spam, el contenido ilegal, las infracciones de derechos de autor y el contenido falso de IA presentado como real. Eres responsable de lo que publicas.",
      },
      {
        title: "Permisos de la iglesia",
        text: "Lo que puedes publicar depende de tu rol. El Pastor y los líderes de la iglesia pueden revisar, limitar o eliminar contenido en los espacios de la iglesia, pero las reglas de la iglesia no pueden permitir lo que Kristo App o la ley prohíben.",
      },
      {
        title: "Seguridad",
        text: "Denuncia el contenido dañino y bloquea a los usuarios abusivos en la app; las denuncias de seguridad se revisan primero. Todo lo que dañe o explote a menores está estrictamente prohibido.",
      },
      {
        title: "Medidas de moderación",
        text: "Las infracciones pueden causar la eliminación de contenido, advertencias, funciones limitadas o la suspensión o cierre de la cuenta. Puedes pedir una revisión a través de Soporte.",
      },
    ],
    readFullTermsLabel: "Leer los términos completos",
    closeLabel: "Cerrar",
  },
  pt: {
    intro: "Ao continuar, você aceita os Termos de Uso e as Diretrizes da Comunidade do Kristo App. O essencial:",
    points: [
      {
        title: "Sua conta",
        text: "Use informações verdadeiras, proteja sua senha e nunca se passe por outra pessoa nem alegue uma autoridade que você não tem.",
      },
      {
        title: "Conteúdo proibido",
        text: "Tolerância zero para assédio, ódio, ameaças, conteúdo sexual ou violento, golpes, spam, conteúdo ilegal, violação de direitos autorais e conteúdo falso de IA apresentado como real. Você é responsável pelo que publica.",
      },
      {
        title: "Permissões da igreja",
        text: "O que você pode publicar depende do seu papel. O Pastor e os líderes da igreja podem revisar, limitar ou remover conteúdo nos espaços da igreja, mas as regras da igreja não podem permitir o que o Kristo App ou a lei proíbem.",
      },
      {
        title: "Segurança",
        text: "Denuncie conteúdo nocivo e bloqueie usuários abusivos no app; denúncias de segurança são analisadas primeiro. Tudo o que prejudique ou explore crianças é estritamente proibido.",
      },
      {
        title: "Medidas de moderação",
        text: "Violações podem levar à remoção de conteúdo, avisos, recursos limitados ou suspensão ou encerramento da conta. Você pode pedir uma revisão pelo Suporte.",
      },
    ],
    readFullTermsLabel: "Ler os termos completos",
    closeLabel: "Fechar",
  },
  ha: {
    intro: "Ta ci gaba, kun yarda da Sharuɗɗan Amfani da Ka'idojin Al'umma na Kristo App. Muhimman abubuwa:",
    points: [
      {
        title: "Asusunka",
        text: "Yi amfani da bayanai na gaskiya, kare kalmar sirrinka, kuma kada ka yi kamar wani mutum ko ka yi da'awar ikon da ba ka da shi.",
      },
      {
        title: "Abubuwan da aka haramta",
        text: "Babu haƙuri ga cin zarafi, ƙiyayya, barazana, abubuwan batsa ko tashin hankali, zamba, spam, abubuwan da suka saɓa wa doka, keta haƙƙin mallaka, da abubuwan AI na ƙarya da ake nunawa kamar na gaske. Kai ne ke da alhakin abin da ka wallafa.",
      },
      {
        title: "Izinin majami'a",
        text: "Abin da za ka iya wallafawa ya dogara da matsayinka. Fasto da shugabannin majami'a za su iya dubawa, takaitawa ko cire abubuwa a wuraren majami'a, amma dokokin majami'a ba za su iya ba da izinin abin da Kristo App ko doka ta haramta ba.",
      },
      {
        title: "Tsaro",
        text: "Ka ba da rahoton abubuwa masu cutarwa kuma ka toshe masu cin zarafi a cikin app; ana fara duba rahotannin tsaro. Duk abin da ke cutarwa ko cin moriyar yara an haramta shi gaba ɗaya.",
      },
      {
        title: "Matakan daidaitawa",
        text: "Keta ka'idoji na iya kawo cire abubuwa, gargaɗi, takaita wasu ayyuka, ko dakatarwa ko rufe asusu. Kana iya neman a sake dubawa ta hanyar Tallafi.",
      },
    ],
    readFullTermsLabel: "Karanta cikakkun sharuɗɗa",
    closeLabel: "Rufe",
  },
  yo: {
    intro: "Bí o bá tẹ̀ síwájú, o gbà sí Àwọn Òfin Lílo àti Ìlànà Àwùjọ Kristo App. Àwọn kókó pàtàkì:",
    points: [
      {
        title: "Àkántì rẹ",
        text: "Lo ìsọfúnni òtítọ́, dáàbò bo ọ̀rọ̀ aṣínà rẹ, má sì ṣe díbọ́n pé o jẹ́ ẹlòmíràn tàbí sọ pé o ní àṣẹ tí o kò ní.",
      },
      {
        title: "Àkóónú tí a kà léèwọ̀",
        text: "Kò sí ìfaradà fún ìyọlẹ́nu, ìkórìíra, ìhalẹ̀mọ́ni, àkóónú ìbálòpọ̀ tàbí ìwà ipá, jìbìtì, spam, àkóónú tí kò bófin mu, rírú ẹ̀tọ́ àṣẹ-ìṣẹ̀dá, àti àkóónú AI èké tí a gbé kalẹ̀ bí òótọ́. Ìwọ ni o ni ojúṣe fún ohun tí o bá fi síta.",
      },
      {
        title: "Àṣẹ ìjọ",
        text: "Ohun tí o lè fi síta dá lórí ipa rẹ. Pásítọ̀ àti àwọn aṣáájú ìjọ lè ṣàyẹ̀wò, dín kù, tàbí yọ àkóónú kúrò ní àwọn ààyè ìjọ, ṣùgbọ́n òfin ìjọ kò lè fàyè gba ohun tí Kristo App tàbí òfin orílẹ̀-èdè kà léèwọ̀.",
      },
      {
        title: "Ààbò",
        text: "Jábọ̀ àkóónú tó léwu kí o sì dí àwọn olùyọlẹ́nu lọ́wọ́ nínú app; a máa ń kọ́kọ́ ṣàyẹ̀wò ìjábọ̀ ààbò. Ohunkóhun tó bá ṣe àwọn ọmọdé léṣe tàbí lò wọ́n nílòkulò ni a kà léèwọ̀ pátápátá.",
      },
      {
        title: "Ìgbésẹ̀ ìmúṣe",
        text: "Rírú òfin lè yọrí sí yíyọ àkóónú kúrò, ìkìlọ̀, dídín àwọn iṣẹ́ kù, tàbí ìdádúró tàbí ìparí àkántì. O lè béèrè fún àtúnyẹ̀wò nípasẹ̀ Support.",
      },
    ],
    readFullTermsLabel: "Ka gbogbo òfin",
    closeLabel: "Pa á dé",
  },
  ar: {
    intro: "بالمتابعة، فإنك توافق على شروط الاستخدام وإرشادات المجتمع في Kristo App. أهم النقاط:",
    points: [
      {
        title: "حسابك",
        text: "استخدم معلومات صحيحة، واحمِ كلمة المرور، ولا تنتحل شخصية أحد أو تدّعِ صلاحية لا تملكها.",
      },
      {
        title: "المحتوى المحظور",
        text: "عدم التسامح مطلقًا مع التحرش والكراهية والتهديد والمحتوى الجنسي أو العنيف والاحتيال والرسائل المزعجة والمحتوى غير القانوني وانتهاك حقوق النشر ومحتوى الذكاء الاصطناعي المزيّف المقدَّم على أنه حقيقي. أنت مسؤول عمّا تنشره.",
      },
      {
        title: "صلاحيات الكنيسة",
        text: "ما يمكنك نشره يعتمد على دورك. يمكن للقس وقادة الكنيسة مراجعة المحتوى في مساحات الكنيسة أو تقييده أو إزالته، لكن قواعد الكنيسة لا يمكن أن تسمح بما يحظره Kristo App أو القانون.",
      },
      {
        title: "السلامة",
        text: "أبلغ عن المحتوى الضار واحظر المستخدمين المسيئين داخل التطبيق؛ تُراجَع بلاغات السلامة أولًا. كل ما يؤذي القُصّر أو يستغلهم محظور تمامًا.",
      },
      {
        title: "إجراءات الإشراف",
        text: "قد تؤدي المخالفات إلى إزالة المحتوى أو التحذير أو تقييد الميزات أو تعليق الحساب أو إنهائه. يمكنك طلب المراجعة عبر الدعم.",
      },
    ],
    readFullTermsLabel: "اقرأ الشروط كاملة",
    closeLabel: "إغلاق",
  },
  hi: {
    intro: "आगे बढ़कर, आप क्रिस्टो ऐप की उपयोग की शर्तों और समुदाय दिशानिर्देशों से सहमत होते हैं। मुख्य बातें:",
    points: [
      {
        title: "आपका खाता",
        text: "सच्ची जानकारी दें, अपना पासवर्ड सुरक्षित रखें, और कभी किसी और का रूप न धरें या ऐसा अधिकार न जताएँ जो आपके पास नहीं है।",
      },
      {
        title: "प्रतिबंधित सामग्री",
        text: "उत्पीड़न, नफ़रत, धमकी, यौन या हिंसक सामग्री, धोखाधड़ी, स्पैम, अवैध सामग्री, कॉपीराइट उल्लंघन और असली बताकर पेश की गई नकली AI सामग्री के प्रति शून्य सहिष्णुता। आप जो पोस्ट करते हैं, उसकी ज़िम्मेदारी आपकी है।",
      },
      {
        title: "चर्च की अनुमतियाँ",
        text: "आप क्या पोस्ट कर सकते हैं, यह आपकी भूमिका पर निर्भर है। पास्टर और चर्च के अगुवे चर्च के स्थानों में सामग्री की समीक्षा कर सकते हैं, उसे सीमित या हटा सकते हैं, लेकिन चर्च के नियम वह अनुमति नहीं दे सकते जिसे क्रिस्टो ऐप या कानून मना करता है।",
      },
      {
        title: "सुरक्षा",
        text: "ऐप में हानिकारक सामग्री की रिपोर्ट करें और दुर्व्यवहार करने वाले उपयोगकर्ताओं को ब्लॉक करें; सुरक्षा रिपोर्टों की समीक्षा पहले होती है। बच्चों को नुकसान पहुँचाने या उनका शोषण करने वाली हर चीज़ सख्ती से प्रतिबंधित है।",
      },
      {
        title: "मॉडरेशन कार्रवाई",
        text: "उल्लंघन होने पर सामग्री हटाई जा सकती है, चेतावनी दी जा सकती है, सुविधाएँ सीमित की जा सकती हैं, या खाता निलंबित या समाप्त किया जा सकता है। आप सहायता के ज़रिए समीक्षा का अनुरोध कर सकते हैं।",
      },
    ],
    readFullTermsLabel: "पूरी शर्तें पढ़ें",
    closeLabel: "बंद करें",
  },
  "zh-CN": {
    intro: "继续即表示您同意 Kristo App 的使用条款与社区准则。要点如下：",
    points: [
      {
        title: "您的账户",
        text: "请使用真实信息，保护好您的密码，切勿冒充他人或声称拥有您并不具备的权限。",
      },
      {
        title: "禁止的内容",
        text: "对骚扰、仇恨、威胁、色情或暴力内容、诈骗、垃圾信息、违法内容、侵犯版权以及冒充真实的虚假 AI 内容零容忍。您需对自己发布的内容负责。",
      },
      {
        title: "教会权限",
        text: "您可以发布的内容取决于您的角色。牧师和教会领袖可以审核、限制或删除教会空间中的内容，但教会规则不能允许 Kristo App 或法律所禁止的内容。",
      },
      {
        title: "安全",
        text: "您可以在应用内举报有害内容并屏蔽滥用用户；安全举报会被优先审核。任何伤害或剥削未成年人的行为都被严格禁止。",
      },
      {
        title: "审核与处理",
        text: "违规可能导致内容被删除、警告、功能受限，或账户被暂停或终止。您可以通过支持渠道申请复核。",
      },
    ],
    readFullTermsLabel: "阅读完整条款",
    closeLabel: "关闭",
  },
};
