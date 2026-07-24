export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

interface FieldRange {
  min: number;
  max: number;
}

const RANGES: FieldRange[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
];

function parseField(field: string, range: FieldRange): Set<number> | null {
  if (field === "") return null;
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) return null;
      step = Number(stepPart);
      if (step === 0) return null;
    }

    let start = range.min;
    let end = range.max;
    if (rangePart === "*") {
      // full range with optional step
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return null;
      start = Number(a);
      end = Number(b);
      if (start < range.min || end > range.max || start > end) return null;
    } else {
      if (stepPart !== undefined) return null;
      if (!/^\d+$/.test(rangePart)) return null;
      const value = Number(rangePart);
      if (value < range.min || value > range.max) return null;
      start = value;
      end = value;
    }

    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

export function parseCron(expr: string): CronFields | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5 || expr.trim() === "") return null;

  const parsed = fields.map((field, index) => parseField(field, RANGES[index]));
  if (parsed.some((set) => set === null)) return null;
  const [minute, hour, dom, month, dow] = parsed as Set<number>[];

  // Cron treats both 0 and 7 as Sunday; collapse to 0 for getDay() comparison.
  const normalizedDow = new Set<number>();
  for (const value of dow) normalizedDow.add(value === 7 ? 0 : value);

  return {
    minute,
    hour,
    dom,
    month,
    dow: normalizedDow,
    domRestricted: fields[2] !== "*",
    dowRestricted: fields[4] !== "*",
  };
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}

function dayMatches(fields: CronFields, date: Date): boolean {
  const domMatch = fields.dom.has(date.getDate());
  const dowMatch = fields.dow.has(date.getDay());
  if (fields.domRestricted && fields.dowRestricted) return domMatch || dowMatch;
  if (fields.domRestricted) return domMatch;
  if (fields.dowRestricted) return dowMatch;
  return true;
}

/**
 * The first time a cron expression fires strictly after `from`, in local time,
 * or null when it never fires within a bounded horizon (e.g. Feb 30).
 */
export function nextCronTime(
  expr: string | CronFields,
  from: Date,
): Date | null {
  const fields = typeof expr === "string" ? parseCron(expr) : expr;
  if (!fields) return null;

  const date = new Date(from);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);

  const horizon = from.getFullYear() + 5;
  while (date.getFullYear() <= horizon) {
    if (!fields.month.has(date.getMonth() + 1)) {
      date.setMonth(date.getMonth() + 1, 1);
      date.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(fields, date)) {
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
      continue;
    }
    if (!fields.hour.has(date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!fields.minute.has(date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1, 0, 0);
      continue;
    }
    return date;
  }
  return null;
}

export interface CronPreset {
  id: string;
  expr: string;
}

export const CRON_PRESETS: CronPreset[] = [
  { id: "hourly", expr: "0 * * * *" },
  { id: "every6h", expr: "0 */6 * * *" },
  { id: "daily", expr: "0 3 * * *" },
  { id: "weekdays", expr: "0 9 * * 1-5" },
  { id: "weekly", expr: "0 3 * * 0" },
  { id: "monthly", expr: "0 3 1 * *" },
];
