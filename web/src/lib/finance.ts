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

export interface RowError {
  index: number;
  message: string;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  return q.toString();
};

export const financeApi = {
  meta: () => request<FinanceMeta>("GET", "/finance/meta"),
  updateSettings: (base_currency: string) => request<FinanceMeta>("PUT", "/finance/settings", { base_currency }),
  fx: (currency: string, date: string) => request<FxQuote>("GET", `/finance/fx?${qs({ currency, date })}`),

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
  createTransaction: (input: TxInput) => request<Transaction>("POST", "/finance/transactions", input),
  bulkCreate: (transactions: TxInput[]) =>
    request<{ created: number; skipped: number }>("POST", "/finance/transactions/bulk", { transactions }),
  updateTransaction: (id: number, input: TxInput) => request<Transaction>("PUT", `/finance/transactions/${id}`, input),
  deleteTransaction: (id: number) => request<void>("DELETE", `/finance/transactions/${id}`),

  stats: (from: string, to: string) => request<FinanceStats>("GET", `/finance/stats?${qs({ from, to })}`),
  trend: (end: string, months: number) => request<TrendPoint[]>("GET", `/finance/trend?${qs({ end, months })}`),
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
  return rate.toLocaleString(localeFor(lang), { maximumFractionDigits: rate >= 100 ? 2 : 6 });
}

export function monthLabel(month: string, lang: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(localeFor(lang), { month: "long", year: "numeric" });
}

// ---- category helpers ----

export function categoryLabel(meta: FinanceMeta, id: number | null): { icon: string; name: string; parent?: string } | null {
  if (id == null) return null;
  const c = meta.categories.find((x) => x.id === id);
  if (!c) return null;
  if (c.parent_id == null) return { icon: c.icon, name: c.name };
  const p = meta.categories.find((x) => x.id === c.parent_id);
  return { icon: p?.icon ?? "", name: c.name, parent: p?.name };
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
    return idx === undefined ? "" : (r[idx] ?? "").trim();
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
const YESTERDAY = /\b(yesterday|kemarin|kmrn)\b|昨天/i;
const DAY_BEFORE = /day before yesterday|kemarin lusa|前天/i;

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
export function parseQuickEntry(text: string, meta: FinanceMeta): QuickDraft[] {
  const segments = text
    .split(/\s*(?:[;；，、\n]|,\s+|\band\b|\bdan\b|\blalu\b|\bterus\b|然后|还有)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const drafts: QuickDraft[] = [];
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    const m = lower.match(AMOUNT_RE);
    if (!m || !m[1]) {
      if (drafts.length > 0) drafts[drafts.length - 1].note += ` ${seg}`;
      continue;
    }
    const base = parseAmount(m[1]);
    const amount = base === null ? null : base * multiplierFor(m[2] ?? m[3]);

    let currency = meta.base_currency;
    for (const [re, code] of CURRENCY_WORDS) {
      if (re.test(seg)) {
        currency = code;
        break;
      }
    }

    let occurred = todayISO();
    if (DAY_BEFORE.test(seg)) occurred = addDays(occurred, -2);
    else if (YESTERDAY.test(seg)) occurred = addDays(occurred, -1);

    const category = matchCategory(lower, meta);
    let kind: Kind = category?.kind ?? (INCOME_HINTS.test(seg) ? "income" : "expense");
    if (!category && INCOME_HINTS.test(seg)) kind = "income";

    let method: PaymentMethod | null = null;
    for (const p of activeMethods(meta)) {
      const aliases = [p.name, ...(METHOD_ALIASES[p.name] ?? [])];
      if (aliases.some((a) => containsWord(lower, a))) {
        method = p;
        break;
      }
    }

    drafts.push({
      kind,
      amount,
      currency,
      occurred_on: occurred,
      category_id: category?.id ?? null,
      payment_method_id: method?.id ?? null,
      note: seg,
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
