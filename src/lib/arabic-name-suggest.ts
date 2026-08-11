/**
 * הצעת שם לקוח בערבית מתעתיק לטיני (לא תרגום מכונה חיצוני).
 * מילון שמות נפוצים + חלקיקים (أبو / آل / عبد…) + נרמול איות.
 */
import { containsArabic } from "@/lib/arabic-text";
import { containsHebrew, transliterateHebrewToArabic } from "@/lib/hebrew-name-transliterate";

/** מפתח = טוקן לטיני מנורמל (lowercase, ללא סימנים) */
const NAME_TOKEN_AR: Record<string, string> = {
  // חלקיקים / קידומות
  abu: "أبو",
  abou: "أبو",
  abo: "أبو",
  ab: "أب",
  bin: "بن",
  ben: "بن",
  bint: "بنت",
  ibn: "ابن",
  al: "ال",
  el: "ال",
  ul: "ال",
  abd: "عبد",
  abdul: "عبد ال",
  abdel: "عبد ال",
  abdal: "عبد ال",
  abdallah: "عبد الله",
  abdullah: "عبد الله",
  abdellah: "عبد الله",

  // שמות פרטיים נפוצים
  mohammed: "محمد",
  mohammad: "محمد",
  muhammad: "محمد",
  mohamed: "محمد",
  muhamed: "محمد",
  mohamad: "محمد",
  mohmmed: "محمد",
  mohmmedd: "محمد",
  mohmmad: "محمد",
  mohemmad: "محمد",
  muhamad: "محمد",
  mahmoud: "محمود",
  mahmud: "محمود",
  mahmood: "محمود",
  ahmad: "أحمد",
  ahmed: "أحمد",
  ahmet: "أحمد",
  khatib: "خطيب",
  khateeb: "خطيب",
  david: "دافيد",
  dafid: "دافيد",
  cohen: "كوهين",
  kohen: "كوهين",
  sulaiman: "سليمان",
  sulayman: "سليمان",
  sleiman: "سليمان",
  ali: "علي",
  aly: "علي",
  hassan: "حسن",
  hasan: "حسن",
  hussein: "حسين",
  husain: "حسين",
  hussain: "حسين",
  hosein: "حسين",
  omar: "عمر",
  umar: "عمر",
  omer: "عمر",
  khaled: "خالد",
  khalid: "خالد",
  yousef: "يوسف",
  yusuf: "يوسف",
  yosef: "يوسف",
  joseph: "يوسف",
  ibrahim: "إبراهيم",
  ibrahem: "إبراهيم",
  ebrahim: "إبراهيم",
  ibraheem: "إبراهيم",
  mustafa: "مصطفى",
  mostafa: "مصطفى",
  moustafa: "مصطفى",
  saleh: "صالح",
  salih: "صالح",
  salah: "صلاح",
  sami: "سامي",
  samy: "سامي",
  samih: "سميح",
  sameh: "سامح",
  samiha: "سميحة",
  shadi: "شادي",
  shady: "شادي",
  nidal: "نضال",
  nidaa: "نداء",
  nida: "نداء",
  marah: "مرح",
  rahaf: "رهف",
  layla: "ليلى",
  leila: "ليلى",
  laila: "ليلى",
  nihaya: "نهاية",
  nehaya: "نهاية",
  hanan: "حنان",
  haneen: "حنين",
  hanin: "حنين",
  asmaa: "أسماء",
  asma: "أسماء",
  asmaaa: "أسماء",
  amar: "عمار",
  ammar: "عمار",
  amer: "عامر",
  amir: "أمير",
  ameer: "أمير",
  anas: "أنس",
  eyad: "إياد",
  iyad: "إياد",
  ihab: "إيهاب",
  ehab: "إيهاب",
  iyhab: "إيهاب",
  fares: "فارس",
  faris: "فارس",
  jawad: "جواد",
  jiris: "جريس",
  jeries: "جريس",
  george: "جورج",
  elyas: "إلياس",
  elias: "إلياس",
  ilyas: "إلياس",
  bader: "بدر",
  badr: "بدر",
  tomer: "تومر",
  tomar: "تومار",
  tabasco: "تاباسكو",
  heba: "هبة",
  hiba: "هبة",
  fatima: "فاطمة",
  fatimah: "فاطمة",
  fatma: "فاطمة",
  muna: "منى",
  mona: "منى",
  asia: "آسيا",
  siraj: "سراج",
  ranen: "رانين",
  raneen: "رانين",
  zahra: "زهرة",
  zahraa: "زهراء",
  nour: "نور",
  noor: "نور",
  nur: "نور",
  rami: "رامي",
  ramy: "رامي",
  waleed: "وليد",
  walid: "وليد",
  wlid: "وليد",
  bilal: "بلال",
  majed: "ماجد",
  majid: "ماجد",
  nader: "نادر",
  basel: "باسل",
  basil: "باسل",
  tamer: "تامر",
  tareq: "طارق",
  tariq: "طارق",
  tarek: "طارق",
  osama: "أسامة",
  usama: "أسامة",
  issa: "عيسى",
  isa: "عيسى",
  musa: "موسى",
  mousa: "موسى",
  yahya: "يحيى",
  yehya: "يحيى",
  zakaria: "زكريا",
  zakariya: "زكريا",
  raed: "رائد",
  raedh: "رائد",
  zuheir: "زهير",
  zuhair: "زهير",
  zohair: "زهير",
  kamal: "كمال",
  jamal: "جمال",
  jameel: "جميل",
  jamil: "جميل",
  nabil: "نبيل",
  nabeel: "نبيل",
  fadi: "فادي",
  fady: "فادي",
  rana: "رانا",
  rania: "رانيا",
  ranya: "رانيا",
  sara: "سارة",
  sarah: "سارة",
  salma: "سلمى",
  dina: "دينا",
  dana: "دانا",
  lina: "لينا",
  maya: "مايا",
  maryam: "مريم",
  mariam: "مريم",
  miriam: "مريم",
  aisha: "عائشة",
  aysha: "عائشة",
  aesha: "عائشة",
  khadija: "خديجة",
  khadijah: "خديجة",
  latifa: "لطيفة",
  latifah: "لطيفة",
  manal: "منال",
  amal: "أمل",
  imad: "عماد",
  emad: "عماد",
  isam: "عصام",
  essam: "عصام",
  ayman: "أيمن",
  eyman: "أيمن",
  hatem: "حاتم",
  hatim: "حاتم",
  adil: "عادل",
  adel: "عادل",
  aziz: "عزيز",
  azzat: "عزت",
  azat: "عزت",
  izzat: "عزت",
  kurd: "كرد",
  alkurd: "الكرد",
  arab: "عرب",
  arabi: "عربي",
  arabia: "عربية",

  // משפחות / שמות משפחה נפוצים באזור
  madboh: "مدبوح",
  madbouh: "مدبوح",
  almadbouh: "المدبوح",
  almadboh: "المدبوح",
  kailani: "كيلاني",
  kilani: "كيلاني",
  kaylani: "كيلاني",
  daher: "ظاهر",
  zaher: "ظاهر",
  dahir: "ظاهر",
  saadi: "سعدي",
  saady: "سعدي",
  sadi: "سعدي",
  afach: "عفاش",
  affash: "عفاش",
  afash: "عفاش",
  sbiyah: "سبيح",
  sbih: "سبيح",
  sbieh: "سبيح",
  isawi: "عيساوي",
  essawi: "عيساوي",
  issawi: "عيساوي",
  elyasy: "الياسي",
  jadallah: "جاد الله",
  jadalla: "جاد الله",
  mohtaseb: "محتسب",
  muhtaseb: "محتسب",
  almohtaseb: "المحتسب",
  almuhtaseb: "المحتسب",
  klepatra: "كليوباترا",
  cleopatra: "كليوباترا",
  awad: "عوض",
  aoud: "عوض",
  punto: "بونتو",
  naddaf: "نداف",
  nadaf: "نداف",
  khalaila: "خلايلة",
  khalayleh: "خلايلة",
  heidar: "حيدر",
  haidar: "حيدر",
  haydar: "حيدر",
  alyan: "عليان",
  alayan: "عليان",
  hojairat: "حجيرات",
  hujairat: "حجيرات",
  soub: "صوب",
  sob: "صوب",
  karim: "كريم",
  kareem: "كريم",
  alwan: "علوان",
  zeydan: "زيدان",
  zeidan: "زيدان",
  zidan: "زيدان",
  aloubrah: "العبرة",
  alobra: "العبرة",
  edais: "عديس",
  shamali: "شمالي",
  shemali: "شمالي",
  abid: "عبيد",
  obeid: "عبيد",
  ubaid: "عبيد",
  musaalm: "موسى",
};

function normalizeToken(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** מפרק שם לטיני לטוקנים (כולל סוגריים כהערות) */
export function tokenizeLatinName(name: string): string[] {
  const cleaned = name
    .replace(/[()[\]{}]/g, " ")
    .replace(/[_./\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned.split(" ").filter(Boolean);
}

function resolveToken(token: string): string | null {
  const n = normalizeToken(token);
  if (!n) return null;
  if (NAME_TOKEN_AR[n]) return NAME_TOKEN_AR[n];

  // AL-XXX / EL-XXX
  const al = n.match(/^(al|el)(.+)$/);
  if (al?.[2] && al[2].length >= 3) {
    const rest = NAME_TOKEN_AR[al[2]];
    if (rest) {
      if (rest.startsWith("ال")) return rest;
      return `ال${rest}`;
    }
  }

  // ABUXXX דבוק
  const abu = n.match(/^abu(.+)$/);
  if (abu?.[1] && abu[1].length >= 3) {
    const rest = NAME_TOKEN_AR[abu[1]];
    if (rest) return `أبو ${rest}`;
  }

  // ABDULXXX
  const abdul = n.match(/^abd(?:ul|el|al)(.+)$/);
  if (abdul?.[1] && abdul[1].length >= 3) {
    const rest = NAME_TOKEN_AR[abdul[1]] || null;
    if (rest) return `عبد ال${rest.replace(/^ال/, "")}`;
  }

  return null;
}

export type ArabicNameSuggestion = {
  /** הצעה בערבית, או null אם אין כיסוי מספיק */
  suggested: string | null;
  /** כמה טוקנים מופו לערבית */
  mappedCount: number;
  /** כמה טוקנים לטיניים היו */
  tokenCount: number;
  /** האם כל הטוקנים מופו */
  complete: boolean;
};

/**
 * מציע שם בערבית משם לטיני/אנגלי.
 * אם הקלט כבר בערבית — מחזיר אותו.
 */
export function suggestArabicCustomerName(latinOrMixed: string | null | undefined): ArabicNameSuggestion {
  const raw = (latinOrMixed ?? "").trim();
  if (!raw) return { suggested: null, mappedCount: 0, tokenCount: 0, complete: false };
  if (containsArabic(raw)) {
    return { suggested: raw, mappedCount: 1, tokenCount: 1, complete: true };
  }

  if (containsHebrew(raw)) {
    const he = transliterateHebrewToArabic(raw, "customer");
    if (he.suggested) {
      return {
        suggested: he.suggested,
        mappedCount: he.mappedCount,
        tokenCount: he.tokenCount,
        complete: he.complete,
      };
    }
  }

  const tokens = tokenizeLatinName(raw);
  if (tokens.length === 0) {
    return { suggested: null, mappedCount: 0, tokenCount: 0, complete: false };
  }

  const parts: string[] = [];
  let mapped = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const n = normalizeToken(t);

    // AL / EL + המילה הבאה → ال… בלי רווח (المحتسب)
    if ((n === "al" || n === "el") && i + 1 < tokens.length) {
      const next = resolveToken(tokens[i + 1]!);
      if (next) {
        const joined = next.startsWith("ال") ? next : `ال${next}`;
        parts.push(joined);
        mapped += 2;
        i++;
        continue;
      }
    }

    // ABU + המילה הבאה
    if ((n === "abu" || n === "abou" || n === "abo") && i + 1 < tokens.length) {
      const next = resolveToken(tokens[i + 1]!);
      if (next) {
        parts.push(`أبو ${next}`);
        mapped += 2;
        i++;
        continue;
      }
    }

    const ar = resolveToken(t);
    if (ar) {
      parts.push(ar);
      mapped++;
    }
  }

  // דורשים לפחות טוקן אחד ממופה; אם רוב השם ממופה — מחזירים הצעה
  if (mapped === 0) {
    return { suggested: null, mappedCount: 0, tokenCount: tokens.length, complete: false };
  }

  // אם פחות ממחצית הטוקנים ממופו — עדיין מציעים את מה שיש (עדיף מלא־אנגלי)
  const suggested = parts.join(" ").replace(/\s+/g, " ").trim();
  return {
    suggested: suggested || null,
    mappedCount: mapped,
    tokenCount: tokens.length,
    complete: mapped === tokens.length,
  };
}

export { resolveCourierPdfCustomerName } from "@/lib/arabic-display-name";
