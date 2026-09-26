import { request } from "./api";

export type Kind = "income" | "expense";
export type TxSource = "manual" | "csv" | "voice" | "email";

export interface Category {
  id: number;
  kind: Kind;
  parent_id: number | null;
  name: string;
  icon: string;
  position: number;
  archived: boolean;
}

export interface PaymentMethod {
  id: number;
  name: string;
  icon: string;
  position: number;
  archived: boolean;
}

export interface FinanceMeta {
  base_currency: string;
  currencies: string[];
  categories: Category[];
  payment_methods: PaymentMethod[];
  has_transactions: boolean;
  has_budgets: boolean;
  stats_layout: StatsWidgetPref[] | null;
}

export interface StatsWidgetPref {
  key: string;
  visible: boolean;
}

export interface Transaction {
  id: number;
  kind: Kind;
  occurred_on: string;
  amount: number;
  currency: string;
  rate: number;
  base_amount: number;
  category_id: number | null;
  payment_method_id: number | null;
  note: string;
  source: TxSource;
  external_id?: string;
}

export interface TxInput {
  kind: Kind;
  occurred_on: string;
  amount: number;
  currency: string;
  rate?: number;
  category_id: number | null;
  payment_method_id: number | null;
  note: string;
  source?: TxSource;
}

export interface CategoryTotal {
  id: number | null;
  kind: Kind;
  total: number;
  children?: CategoryTotal[];
}

export interface FinanceStats {
  income: number;
  expense: number;
  categories: CategoryTotal[];
}

export interface TrendPoint {
  month: string;
  income: number;
  expense: number;
}

export interface Budget {
  category_id: number;
  amount: number | null;
  spent: number;
}

export interface FxQuote {
  currency: string;
  base: string;
  rate: number;
  date: string;
}

export interface NoteSuggestion {
  note: string;
  kind: Kind;
  category_id: number | null;
  payment_method_id: number | null;
  use_count: number;
  last_used: string;
}

export interface NoteList {
  notes: NoteSuggestion[];
  truncated: boolean;
}

export interface RowError {
  index: number;
  message: string;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  return q.toString();
};

// Suggestion list cache, one per account (keyed by user id) so switching
// accounts in the same tab never shows someone else's notes.
const noteCache = new Map<number, Promise<NoteList>>();

function afterNoteWrite<T>(v: T): T {
  noteCache.clear();
  return v;
}

export function loadNotes(userId: number): Promise<NoteList> {
  let p = noteCache.get(userId);
  if (!p) {
    p = financeApi.notes().catch((e) => {
      noteCache.delete(userId);
      throw e;
    });
    noteCache.set(userId, p);
  }
  return p;
}

export const financeApi = {
  meta: () => request<FinanceMeta>("GET", "/finance/meta"),
  changeBaseCurrency: (input: { base_currency: string; mode?: "convert" | "reset"; rate?: number }) =>
    request<FinanceMeta>("PUT", "/finance/settings/base-currency", input).then(afterNoteWrite),
  updateStatsLayout: (layout: StatsWidgetPref[]) => request<void>("PUT", "/finance/settings/stats-layout", { layout }),
  fx: (currency: string, date: string, base?: string) => request<FxQuote>("GET", `/finance/fx?${qs({ currency, date, base })}`),

  createCategory: (input: { kind: Kind; parent_id: number | null; name: string; icon: string }) =>
    request<Category>("POST", "/finance/categories", input),
  updateCategory: (id: number, input: { name: string; icon: string; archived: boolean }) =>
    request<void>("PUT", `/finance/categories/${id}`, input),
  deleteCategory: (id: number) => request<{ archived: boolean }>("DELETE", `/finance/categories/${id}`),
  reorderCategories: (ids: number[]) => request<void>("PUT", "/finance/categories/order", { ids }),

  createPaymentMethod: (input: { name: string; icon: string }) =>
    request<PaymentMethod>("POST", "/finance/payment-methods", input),
  updatePaymentMethod: (id: number, input: { name: string; icon: string; archived: boolean }) =>
    request<void>("PUT", `/finance/payment-methods/${id}`, input),
  deletePaymentMethod: (id: number) => request<{ archived: boolean }>("DELETE", `/finance/payment-methods/${id}`),
  reorderPaymentMethods: (ids: number[]) => request<void>("PUT", "/finance/payment-methods/order", { ids }),

  listTransactions: (p: { from: string; to: string; kind?: string; category_id?: number; payment_method_id?: number; q?: string }) =>
    request<Transaction[]>("GET", `/finance/transactions?${qs(p)}`),
  // Every write that can change a note also drops the cached suggestion list.
  createTransaction: (input: TxInput) =>
    request<Transaction>("POST", "/finance/transactions", input).then(afterNoteWrite),
  bulkCreate: (transactions: TxInput[]) =>
    request<{ created: number; skipped: number }>("POST", "/finance/transactions/bulk", { transactions }).then(afterNoteWrite),
  updateTransaction: (id: number, input: TxInput) =>
    request<Transaction>("PUT", `/finance/transactions/${id}`, input).then(afterNoteWrite),
  deleteTransaction: (id: number) => request<void>("DELETE", `/finance/transactions/${id}`).then(afterNoteWrite),
  notes: (q?: string) => request<NoteList>("GET", `/finance/notes?${qs({ q })}`),

  stats: (from: string, to: string) => request<FinanceStats>("GET", `/finance/stats?${qs({ from, to })}`),
  trend: (end: string, months: number, category_id?: number) =>
    request<TrendPoint[]>("GET", `/finance/trend?${qs({ end, months, category_id })}`),
  budgets: (month: string) => request<Budget[]>("GET", `/finance/budgets?${qs({ month })}`),
  setBudget: (categoryId: number, amount: number) => request<void>("PUT", `/finance/budgets/${categoryId}`, { amount }),
};

// ---- dates (always local calendar dates, never UTC-shifted) ----

const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toISODate(new Date(y, m - 1, d + n));
}

export function currentMonth(): string {
  return todayISO().slice(0, 7);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: toISODate(new Date(y, m, 0)) };
}

export function isValidMonth(v: string | null): v is string {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

// ---- formatting ----

const LOCALES: Record<string, string> = { en: "en-US", id: "id-ID", zh: "zh-CN" };
export const localeFor = (lang: string) => LOCALES[lang] ?? "en-US";

export function formatMoney(value: number, currency: string, lang: string): string {
  const whole = Number.isInteger(Math.round(value * 100) / 100);
  try {
    return new Intl.NumberFormat(localeFor(lang), {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(localeFor(lang))}`;
  }
}

export function formatRate(rate: number, lang: string): string {
  return rate.toLocaleString(localeFor(lang), { maximumSignificantDigits: 6 });
}

// "1 USD = 16,250 IDR" reads better than "1 IDR = 0.0000615 USD", so a
// rate below 1 is shown the other way round.
export function rateLabel(from: string, to: string, rate: number, lang: string): string {
  return rate >= 1 || rate <= 0
    ? `1 ${from} = ${formatRate(rate, lang)} ${to}`
    : `1 ${to} = ${formatRate(1 / rate, lang)} ${from}`;
}

export function monthLabel(month: string, lang: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(localeFor(lang), { month: "long", year: "numeric" });
}

// ---- category helpers ----

export const DEFAULT_CATEGORY_ICON = "🏷️";
export const DEFAULT_METHOD_ICON = "💳";

// A subcategory without its own icon borrows its parent's; anything still
// blank falls back to a neutral tag rather than an anonymous dot.
export function categoryIcon(meta: FinanceMeta, c: Category): string {
  if (c.icon) return c.icon;
  if (c.parent_id != null) {
    const p = meta.categories.find((x) => x.id === c.parent_id);
    if (p?.icon) return p.icon;
  }
  return DEFAULT_CATEGORY_ICON;
}

export function methodIcon(p: PaymentMethod): string {
  return p.icon || DEFAULT_METHOD_ICON;
}

export function categoryLabel(meta: FinanceMeta, id: number | null): { icon: string; name: string; parent?: string } | null {
  if (id == null) return null;
  const c = meta.categories.find((x) => x.id === id);
  if (!c) return null;
  if (c.parent_id == null) return { icon: categoryIcon(meta, c), name: c.name };
  const p = meta.categories.find((x) => x.id === c.parent_id);
  return { icon: categoryIcon(meta, c), name: c.name, parent: p?.name };
}

// Curated icon set for the picker, grouped so it scans quickly.
export const ICON_GROUPS: { key: string; icons: string[] }[] = [
  { key: "food", icons: ["🍜", "🍚", "🍔", "🍕", "🍣", "🥗", "🍳", "🥐", "☕", "🧋", "🍺", "🍰", "🛒", "🥦"] },
  { key: "transport", icons: ["🛵", "🚗", "🚕", "🚌", "🚆", "✈️", "⛽", "🅿️", "🚲", "🚢"] },
  { key: "home", icons: ["🏠", "💡", "💧", "📶", "🔥", "🛋️", "🧹", "🔧", "🪴"] },
  { key: "money", icons: ["💰", "💵", "💳", "🏦", "📈", "💼", "🎉", "🪙", "🧾", "↩️", "📱"] },
  { key: "shopping", icons: ["🛍️", "👕", "👟", "💄", "📦", "🎁", "💻", "📷", "🎧"] },
  { key: "health", icons: ["💊", "🏥", "🦷", "🏋️", "🧘", "💈", "🧴"] },
  { key: "life", icons: ["🎬", "🎮", "🎵", "📚", "🎓", "🐾", "🧸", "👶", "💍", "🙏", "❤️", "🌴", "⚽", "🏷️"] },
];

const ICON_KEYWORDS: [RegExp, string][] = [
  [/pet|cat|dog|hewan|kucing|anjing|宠物|猫|狗/i, "🐾"],
  [/coffee|kopi|咖啡/i, "☕"],
  [/food|makan|eat|meal|restaurant|吃|餐|饭/i, "🍜"],
  [/grocer|belanja dapur|supermarket|超市/i, "🛒"],
  [/car|mobil|汽车/i, "🚗"],
  [/fuel|bensin|gas|油/i, "⛽"],
  [/transport|ojek|grab|gojek|taxi|交通|打车/i, "🛵"],
  [/flight|travel|trip|holiday|liburan|旅/i, "✈️"],
  [/rent|house|home|rumah|kos|房/i, "🏠"],
  [/electric|listrik|电/i, "💡"],
  [/water|air|水/i, "💧"],
  [/internet|wifi|网/i, "📶"],
  [/phone|pulsa|手机|话费/i, "📱"],
  [/subscription|langganan|netflix|spotify|订阅/i, "🔁"],
  [/cloth|baju|fashion|衣/i, "👕"],
  [/shop|belanja|购物/i, "🛍️"],
  [/health|doctor|dokter|hospital|medic|obat|医|药/i, "💊"],
  [/gym|fitness|sport|olahraga|健身|运动/i, "🏋️"],
  [/beauty|salon|hair|rambut|美/i, "💈"],
  [/game|gaming|游戏/i, "🎮"],
  [/movie|film|cinema|bioskop|电影/i, "🎬"],
  [/music|musik|音乐/i, "🎵"],
  [/book|buku|书/i, "📚"],
  [/school|course|kursus|sekolah|education|pendidikan|学/i, "🎓"],
  [/kid|child|anak|baby|bayi|孩|宝宝/i, "🧸"],
  [/gift|hadiah|kado|礼/i, "🎁"],
  [/donat|charity|zakat|sedekah|捐/i, "🙏"],
  [/salary|gaji|工资|薪/i, "💼"],
  [/bonus|奖金/i, "🎉"],
  [/invest|saham|stock|crypto|投资|股/i, "📈"],
  [/interest|bunga|利息/i, "🪙"],
  [/refund|退款/i, "↩️"],
  [/tax|pajak|税/i, "🧾"],
  [/insurance|asuransi|保险/i, "🛡️"],
  [/cash|tunai|现金/i, "💵"],
  [/bank|transfer|银行/i, "🏦"],
  [/pay|wallet|ovo|dana|gopay|shopee|钱包/i, "📱"],
  [/card|kartu|卡/i, "💳"],
];

export function suggestIcon(name: string): string {
  for (const [re, icon] of ICON_KEYWORDS) if (re.test(name)) return icon;
  return "";
}

export function topLevel(meta: FinanceMeta, kind: Kind, includeArchived = false): Category[] {
  return meta.categories
    .filter((c) => c.kind === kind && c.parent_id == null && (includeArchived || !c.archived))
    .sort((a, b) => a.position - b.position || a.id - b.id);
}

export function childrenOf(meta: FinanceMeta, parentId: number, includeArchived = false): Category[] {
  return meta.categories
    .filter((c) => c.parent_id === parentId && (includeArchived || !c.archived))
    .sort((a, b) => a.position - b.position || a.id - b.id);
}

export function activeMethods(meta: FinanceMeta): PaymentMethod[] {
  return meta.payment_methods.filter((p) => !p.archived).sort((a, b) => a.position - b.position || a.id - b.id);
}

// ---- parsing ----

// parseAmount accepts what people actually type or paste: "45000",
// "45.000" and "45,000" (thousands separators, the Indonesian and English
// habits), "12.50"/"12,50" (decimals), with or without a currency symbol.
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const negative = s.startsWith("-");
  s = s.replace(/-/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    s = s.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    const groupedThousands = parts.length > 1 && parts.slice(1).every((p) => p.length === 3) && parts[0].length <= 3;
    s = groupedThousands ? parts.join("") : parts.join(".").replace(/\.(?=.*\.)/g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// parseDate accepts ISO (2026-09-20) and day-first (20/09/2026, 20-9-2026);
// it falls back to month-first only when day-first is impossible.
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const a = +m[1];
    const b = +m[2];
    return b > 12 && a <= 12 ? validDate(year, a, b) : validDate(year, b, a);
  }
  return null;
}

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return toISODate(dt);
}

// parseDelimited is a small RFC-4180-style parser (quoted fields, escaped
// quotes, CRLF), enough for spreadsheet exports without pulling in a library.
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

export const CSV_COLUMNS = ["date", "type", "category", "subcategory", "amount", "currency", "rate", "payment_method", "note"] as const;
type CsvColumn = (typeof CSV_COLUMNS)[number];

const HEADER_ALIASES: Record<CsvColumn, string[]> = {
  date: ["date", "tanggal", "日期", "day"],
  type: ["type", "kind", "jenis", "tipe", "类型", "income/expense"],
  category: ["category", "kategori", "类别", "分类"],
  subcategory: ["subcategory", "sub category", "sub-category", "subkategori", "子类别", "子分类"],
  amount: ["amount", "jumlah", "nominal", "金额", "value"],
  currency: ["currency", "mata uang", "币种", "货币"],
  rate: ["rate", "exchange rate", "kurs", "汇率"],
  payment_method: ["payment_method", "payment method", "payment", "paid with", "metode", "metode pembayaran", "支付方式", "account"],
  note: ["note", "notes", "catatan", "keterangan", "备注", "description", "memo"],
};

export const CSV_TEMPLATE =
  CSV_COLUMNS.join(",") +
  "\n2026-09-01,income,Salary,,15000000,IDR,,Bank transfer,September salary" +
  "\n2026-09-02,expense,Food,Lunch,45000,IDR,,GoPay,Nasi padang" +
  "\n2026-09-03,expense,Bills,Software,20,USD,,Credit card,Cloud storage\n";

export interface ImportedRow {
  date: string | null;
  kind: Kind;
  category: string;
  subcategory: string;
  amount: number | null;
  currency: string;
  rate: number | null;
  paymentMethod: string;
  note: string;
}

const INCOME_WORDS = ["income", "in", "pemasukan", "masuk", "收入", "credit"];

// parseImport turns CSV/TSV text (from a file or a spreadsheet paste) into
// rows. A header row is optional: when present, columns are matched by name
// (English/Indonesian/Chinese), otherwise the template's column order is used.
export function parseImport(text: string): ImportedRow[] {
  text = text.replace(/^\uFEFF/, "");
  const rows = parseDelimited(text, detectDelimiter(text));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const colIndex: Partial<Record<CsvColumn, number>> = {};
  for (const col of CSV_COLUMNS) {
    const idx = header.findIndex((h) => HEADER_ALIASES[col].includes(h));
    if (idx >= 0) colIndex[col] = idx;
  }
  const hasHeader = colIndex.date !== undefined || colIndex.amount !== undefined;
  const body = hasHeader ? rows.slice(1) : rows;
  const at = (r: string[], col: CsvColumn) => {
    const idx = hasHeader ? colIndex[col] : CSV_COLUMNS.indexOf(col);
    // Undo the export's formula guard ('=... → =...) so a round trip is lossless.
    return idx === undefined ? "" : (r[idx] ?? "").trim().replace(/^'(?=[=+\-@])/, "");
  };
  return body.map((r) => {
    let amount = parseAmount(at(r, "amount"));
    const typeRaw = at(r, "type").toLowerCase();
    let kind: Kind = INCOME_WORDS.includes(typeRaw) ? "income" : "expense";
    if (!typeRaw && amount !== null && amount < 0) kind = "expense";
    if (amount !== null) amount = Math.abs(amount);
    const rate = parseAmount(at(r, "rate"));
    return {
      date: parseDate(at(r, "date")),
      kind,
      category: at(r, "category"),
      subcategory: at(r, "subcategory"),
      amount,
      currency: at(r, "currency").toUpperCase(),
      rate: rate && rate > 0 ? rate : null,
      paymentMethod: at(r, "payment_method"),
      note: at(r, "note"),
    };
  });
}

export function findCategoryByNames(meta: FinanceMeta, kind: Kind, category: string, sub: string): Category | null {
  const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const parent = meta.categories.find((c) => c.kind === kind && c.parent_id == null && !c.archived && eq(c.name, category));
  if (!parent) return null;
  if (!sub) return parent;
  return meta.categories.find((c) => c.parent_id === parent.id && !c.archived && eq(c.name, sub)) ?? null;
}

export function findMethodByName(meta: FinanceMeta, name: string): PaymentMethod | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return meta.payment_methods.find((p) => !p.archived && p.name.toLowerCase() === n) ?? null;
}

// ---- spoken / typed quick entry ----

export interface QuickDraft {
  kind: Kind;
  amount: number | null;
  currency: string;
  occurred_on: string;
  category_id: number | null;
  payment_method_id: number | null;
  note: string;
}

const CURRENCY_WORDS: [RegExp, string][] = [
  [/\$|\busd\b|\bdollars?\b|\bdolar\b|美元/i, "USD"],
  [/\bsgd\b|singapore dollars?|新币|新加坡元/i, "SGD"],
  [/€|\beur\b|\beuros?\b|欧元/i, "EUR"],
  [/£|\bgbp\b|\bpounds?\b|英镑/i, "GBP"],
  [/¥|\bjpy\b|\byen\b|日元|日圆/i, "JPY"],
  [/\bmyr\b|\bringgit\b|马币/i, "MYR"],
  [/\bthb\b|\bbaht\b|泰铢/i, "THB"],
  [/\bkrw\b|\bwon\b|韩元/i, "KRW"],
  [/\bcny\b|\brmb\b|\byuan\b|人民币|块钱|元/i, "CNY"],
  [/\brp\.?\b|\brupiah\b|\bidr\b|印尼盾/i, "IDR"],
];

const INCOME_HINTS = /\b(salary|gaji|income|pemasukan|received|receive|got paid|paid me|terima|dapat|bonus|refund|dividend|interest|freelance)\b|收入|工资|薪水|奖金|退款|收到/i;
const YESTERDAY = /\b(?:yesterday|kemarin|kmrn)\b|昨天/i;
const DAY_BEFORE = /\b(?:the )?day before(?: yesterday)?\b|\b(?:two|2) days ago\b|\bkemarin lusa\b|\b(?:dua|2) hari (?:yang )?lalu\b|前天/i;
const DAYS_AGO = /\b(\d{1,2}) (?:days? ago|hari (?:yang )?lalu)\b|(\d{1,2}) ?天前/i;
const TODAY = /\b(?:today|hari ini)\b|今天/i;

// Everyday words (as people say them, in all three languages) that should
// land in a starter category. Only used when a category with that exact name
// still exists; the user's own category names always match directly too.
const CATEGORY_ALIASES: Record<string, string[]> = {
  Breakfast: ["sarapan", "早餐", "早饭"],
  Lunch: ["makan siang", "午饭", "午餐"],
  Dinner: ["makan malam", "晚饭", "晚餐"],
  "Coffee & snacks": ["coffee", "kopi", "snack", "jajan", "咖啡", "零食"],
  Groceries: ["belanja dapur", "supermarket", "indomaret", "alfamart", "超市", "买菜"],
  Fuel: ["bensin", "pertalite", "pertamax", "gas", "加油", "汽油"],
  "Ride-hailing": ["grab", "gojek", "gocar", "goride", "uber", "ojek", "打车", "滴滴"],
  "Parking & tolls": ["parkir", "tol", "parking", "停车", "过路费"],
  Electricity: ["listrik", "pln", "电费"],
  Internet: ["wifi", "indihome", "网费"],
  Phone: ["pulsa", "paket data", "话费"],
  Streaming: ["netflix", "spotify", "youtube premium"],
  Rent: ["sewa", "kos", "kost", "房租"],
  Salary: ["gaji", "工资", "薪水", "salary"],
  Medicine: ["obat", "apotek", "药"],
};

const METHOD_ALIASES: Record<string, string[]> = {
  Cash: ["cash", "tunai", "现金"],
  "Credit card": ["credit card", "kartu kredit", "cc", "信用卡"],
  "Debit card": ["debit", "kartu debit", "借记卡"],
  "Bank transfer": ["transfer", "tf", "转账"],
};

// A unit must not run into more letters ("45 makan" is not 45 million).
const AMOUNT_RE =
  /(?:rp\.?\s*|\$|€|£|¥)?(\d+(?:[.,]\d+)*)\s*(?:(ribu|rb|k|thousand|juta|jt|million|mio|m)(?!\p{L})|(百万|万|千))?/iu;

function multiplierFor(unit: string | undefined): number {
  switch ((unit ?? "").toLowerCase()) {
    case "k":
    case "rb":
    case "ribu":
    case "thousand":
    case "千":
      return 1e3;
    case "万":
      return 1e4;
    case "jt":
    case "juta":
    case "million":
    case "mio":
    case "m":
    case "百万":
      return 1e6;
    default:
      return 1;
  }
}

function containsWord(haystack: string, needle: string): boolean {
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  if (/[㐀-鿿]/.test(n)) return haystack.includes(n);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(haystack);
}

// parseQuickEntry turns something like "lunch 45rb gopay, parkir 5k
// kemarin" into draft transactions. It's deliberately simple pattern
// matching (no AI yet), so every draft goes to the grid for review before
// anything is saved.
// "lalu" means "then" (a new entry) — except in "2 hari lalu" / "yang lalu",
// where it means "ago" and belongs to the date.
const QUICK_SPLIT = /\s*(?:[;；，、\n]|,\s+|\band\b|\bdan\b|(?<!hari |yang )\blalu\b|\bterus\b|然后|还有)\s*/i;
const UNIT_WORDS = new Set(["k", "rb", "ribu", "thousand", "jt", "juta", "million", "mio", "m", "rp", "rp.", "idr"]);

function lastQuickSegment(text: string): { head: string; seg: string } {
  let cut = 0;
  for (const m of text.matchAll(new RegExp(QUICK_SPLIT.source, "gi"))) cut = (m.index ?? 0) + m[0].length;
  return { head: text.slice(0, cut), seg: text.slice(cut) };
}

// quickEntryQuery is what the quick-entry box looks up in remembered notes:
// just the words of the entry being typed right now, without amounts.
export function quickEntryQuery(text: string): string {
  return lastQuickSegment(text)
    .seg.split(/\s+/)
    .filter((w) => w && !/\d/.test(w) && !UNIT_WORDS.has(w.toLowerCase()))
    .join(" ");
}

// applyQuickSuggestion swaps the words of the entry being typed for the
// picked note, keeping any amount already typed ("25rb mie go" → "Mie Gomak 25rb ").
export function applyQuickSuggestion(text: string, note: string): string {
  const { head, seg } = lastQuickSegment(text);
  const kept = seg.split(/\s+/).filter((w) => w && (/\d/.test(w) || UNIT_WORDS.has(w.toLowerCase())));
  return `${head}${[note, ...kept].join(" ")} `;
}

// findRememberedNote matches a quick-entry description to a note used
// before: exactly (ignoring case/spacing), else a single unambiguous
// word-prefix match ("mie gom"), else a clear near-miss spelling.
export function findRememberedNote(list: NoteSuggestion[], text: string): NoteSuggestion | null {
  const q = normalizeNote(text);
  if (!q) return null;
  const exact = list.find((n) => normalizeNote(n.note) === q);
  if (exact) return exact;
  const qWords = q.split(" ");
  const prefix = list.filter((n) => {
    const words = normalizeNote(n.note).split(" ");
    return qWords.every((w) => words.some((kw) => kw.startsWith(w)));
  });
  if (prefix.length === 1 && q.length >= 3) return prefix[0];
  if (q.length < 4) return null;
  const ranked = list
    .map((n) => ({ n, sim: similarity(q, normalizeNote(n.note)) }))
    .sort((a, b) => b.sim - a.sim);
  if (ranked[0] && ranked[0].sim >= 0.68 && (!ranked[1] || ranked[1].sim < ranked[0].sim - 0.1)) return ranked[0].n;
  return null;
}

// parseQuickEntry turns something like "lunch 45rb gopay, parkir 5k
// kemarin" into draft transactions. It's deliberately simple pattern
// matching (no AI yet), so every draft goes to the grid for review before
// anything is saved. The note keeps only the description ("lunch"), so it
// lines up with remembered notes; a remembered note also brings the
// category and payment method it was last booked under.
export function parseQuickEntry(text: string, meta: FinanceMeta, notes: NoteSuggestion[] = []): QuickDraft[] {
  const segments = text
    .split(QUICK_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);

  const drafts: QuickDraft[] = [];
  for (const seg of segments) {
    // Dates come out first, so the "2" in "2 days ago" is never read as the amount.
    let occurred = todayISO();
    let work = seg;
    const ago = work.match(DAYS_AGO);
    if (ago) {
      occurred = addDays(occurred, -Number(ago[1] ?? ago[2]));
      work = work.replace(DAYS_AGO, " ");
    } else if (DAY_BEFORE.test(work)) {
      occurred = addDays(occurred, -2);
      work = work.replace(DAY_BEFORE, " ");
    } else if (YESTERDAY.test(work)) {
      occurred = addDays(occurred, -1);
      work = work.replace(YESTERDAY, " ");
    }
    work = work.replace(TODAY, " ");

    const lower = work.toLowerCase();
    const m = lower.match(AMOUNT_RE);
    if (!m || !m[1]) {
      if (drafts.length > 0) drafts[drafts.length - 1].note += ` ${seg}`;
      continue;
    }
    const base = parseAmount(m[1]);
    const amount = base === null ? null : base * multiplierFor(m[2] ?? m[3]);

    let rest = work.replace(new RegExp(AMOUNT_RE.source, "iu"), " ");

    let currency = meta.base_currency;
    for (const [re, code] of CURRENCY_WORDS) {
      if (re.test(seg)) {
        currency = code;
        rest = rest.replace(re, " ");
        break;
      }
    }

    let method: PaymentMethod | null = null;
    for (const p of activeMethods(meta)) {
      const alias = [p.name, ...(METHOD_ALIASES[p.name] ?? [])].find((a) => containsWord(lower, a));
      if (alias) {
        method = p;
        rest = rest.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu"), "$1 ");
        break;
      }
    }
    rest = rest.replace(/\s+/g, " ").replace(/^[\s,.:;\-–—]+|[\s,.:;\-–—]+$/g, "");

    let category = matchCategory(lower, meta);
    let kind: Kind = category?.kind ?? (INCOME_HINTS.test(seg) ? "income" : "expense");
    let note = rest;

    const remembered = findRememberedNote(notes, rest);
    if (remembered) {
      note = remembered.note;
      const c = remembered.category_id != null ? meta.categories.find((x) => x.id === remembered.category_id && !x.archived) : undefined;
      if (c) {
        category = c;
        kind = c.kind;
      } else if (!category) {
        kind = remembered.kind;
      }
      if (!method && remembered.payment_method_id != null) {
        method = meta.payment_methods.find((p) => p.id === remembered.payment_method_id && !p.archived) ?? null;
      }
    }

    drafts.push({
      kind,
      amount,
      currency,
      occurred_on: occurred,
      category_id: category?.id ?? null,
      payment_method_id: method?.id ?? null,
      note,
    });
  }
  return drafts;
}

function matchCategory(lower: string, meta: FinanceMeta): Category | null {
  const candidates = meta.categories
    .filter((c) => !c.archived)
    .map((c) => ({ c, names: [c.name, ...(CATEGORY_ALIASES[c.name] ?? [])] }));
  let best: { c: Category; len: number } | null = null;
  for (const { c, names } of candidates) {
    for (const n of names) {
      if (containsWord(lower, n)) {
        // Prefer the longest match, and a subcategory over its parent on ties.
        const len = n.length + (c.parent_id != null ? 0.5 : 0);
        if (!best || len > best.len) best = { c, len };
      }
    }
  }
  return best?.c ?? null;
}

// ---- export ----

function csvField(v: string): string {
  // A cell starting with = + - @ is run as a formula by Excel/Sheets; a
  // leading apostrophe keeps it plain text (and import strips it again).
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

// buildExportCsv writes the import template's columns first, so an export
// re-imports as-is, then the base-currency value for spreadsheet totals.
export function buildExportCsv(meta: FinanceMeta, txs: Transaction[]): string {
  const header = [...CSV_COLUMNS, `base_amount_${meta.base_currency.toLowerCase()}`, "source"];
  const lines = [header.join(",")];
  const sorted = [...txs].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.id - b.id);
  for (const t of sorted) {
    const c = t.category_id != null ? meta.categories.find((x) => x.id === t.category_id) : undefined;
    const parent = c?.parent_id != null ? meta.categories.find((x) => x.id === c.parent_id) : undefined;
    const method = t.payment_method_id != null ? meta.payment_methods.find((p) => p.id === t.payment_method_id) : undefined;
    lines.push(
      [
        t.occurred_on,
        t.kind,
        parent ? parent.name : c?.name ?? "",
        parent ? c?.name ?? "" : "",
        String(t.amount),
        t.currency,
        t.currency === meta.base_currency ? "" : String(t.rate),
        method?.name ?? "",
        t.note,
        t.base_amount.toFixed(2),
        t.source,
      ]
        .map(csvField)
        .join(",")
    );
  }
  // BOM so Excel opens it as UTF-8 (emoji, Chinese names, "Rp" all survive).
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- note matching ----

export function normalizeNote(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function bigrams(s: string): string[] {
  const t = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

// Dice similarity on character pairs: forgiving of a dropped or swapped
// letter ("mi gomak" vs "mie gomak"), cheap enough to run on every keystroke.
function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  const counts = new Map<string, number>();
  for (const x of B) counts.set(x, (counts.get(x) ?? 0) + 1);
  let hits = 0;
  for (const x of A) {
    const n = counts.get(x) ?? 0;
    if (n > 0) {
      hits++;
      counts.set(x, n - 1);
    }
  }
  return (2 * hits) / (A.length + B.length);
}

// matchNotes ranks suggestions for what's typed so far: the start of the
// note, then the start of any of its words ("gom" → "Mie Gomak"), then
// anywhere in it, then a near-miss spelling. Ties go to the most used.
export function matchNotes(list: NoteSuggestion[], typed: string, limit = 6): NoteSuggestion[] {
  const q = normalizeNote(typed);
  if (!q) return [];
  const qWords = q.split(" ");
  const scored: { n: NoteSuggestion; score: number }[] = [];
  for (const n of list) {
    const key = normalizeNote(n.note);
    if (key === q) continue;
    const words = key.split(" ");
    let score = 0;
    if (key.startsWith(q)) score = 4;
    else if (qWords.every((w) => words.some((kw) => kw.startsWith(w)))) score = 3;
    else if (key.includes(q)) score = 2;
    else if (q.length >= 3) {
      const sim = similarity(q, key.slice(0, Math.max(q.length + 2, 1)));
      if (sim >= 0.55) score = sim;
    }
    if (score > 0) scored.push({ n, score });
  }
  scored.sort((a, b) => b.score - a.score || b.n.use_count - a.n.use_count || b.n.last_used.localeCompare(a.n.last_used));
  return scored.slice(0, limit).map((x) => x.n);
}
