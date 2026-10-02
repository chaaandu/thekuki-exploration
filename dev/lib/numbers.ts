// Ruby/Shopify Liquid number semantics for a JavaScript engine.
//
// JavaScript has one number type; Liquid (Ruby) distinguishes Integer and Float, and that
// changes results: `7 | divided_by: 2` is 3 but `7 | divided_by: 2.0` is 3.5, and floats print
// as "10.0". Float literals in templates and float results of math filters are wrapped in
// LiquidFloat so the distinction survives. Float math goes through exact decimal arithmetic
// (Liquid converts floats to BigDecimal before +, -, *, %).

export class LiquidFloat {
  readonly value: number;

  constructor(value: number) {
    this.value = value;
  }

  valueOf(): number {
    return this.value;
  }

  toString(): string {
    return rubyFloatToString(this.value);
  }

  toJSON(): number {
    return this.value;
  }

  [Symbol.toPrimitive](hint: string): number | string {
    return hint === 'string' ? this.toString() : this.value;
  }

  // LiquidJS "Comparable" protocol so ==, <, > work with Ruby semantics.
  equals(other: unknown): boolean {
    const o = plainNumber(other);
    return o !== null && o === this.value;
  }

  gt(other: unknown): boolean {
    return compareNumberTo(this.value, other, 'Float') > 0;
  }

  geq(other: unknown): boolean {
    return compareNumberTo(this.value, other, 'Float') >= 0;
  }

  lt(other: unknown): boolean {
    return compareNumberTo(this.value, other, 'Float') < 0;
  }

  leq(other: unknown): boolean {
    return compareNumberTo(this.value, other, 'Float') <= 0;
  }
}

/** Compare a number with another value; returns NaN (=> false for every operator) for nil. */
function compareNumberTo(value: number, other: unknown, className: string): number {
  if (other === null || other === undefined) return Number.NaN;
  const o = plainNumber(other);
  if (o === null) {
    throw new Error(`comparison of ${className} with ${rubyInspect(other)} failed`);
  }
  return value - o;
}

export function rubyInspect(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || value === undefined) return 'nil';
  return String(value);
}

/** Number value of numbers and LiquidFloats, null for anything else. */
export function plainNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (value instanceof LiquidFloat) return value.value;
  return null;
}

export function isFloat(value: unknown): boolean {
  return value instanceof LiquidFloat || (typeof value === 'number' && !Number.isInteger(value));
}

export interface RubyNumber {
  value: number;
  float: boolean;
}

const FLOAT_STRING = /^\s*-?\d+\.\d+\s*$/;
const INT_PREFIX = /^\s*([-+]?\d+)/;

/** Liquid::Utils.to_number */
export function toRubyNumber(value: unknown): RubyNumber {
  if (value instanceof LiquidFloat) return { value: value.value, float: true };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { value, float: true };
    return { value, float: !Number.isInteger(value) };
  }
  if (typeof value === 'string') {
    if (FLOAT_STRING.test(value)) return { value: Number.parseFloat(value), float: true };
    const match = INT_PREFIX.exec(value);
    return { value: match ? Number.parseInt(match[1] as string, 10) : 0, float: false };
  }
  if (typeof value === 'boolean' || value === null || value === undefined) return { value: 0, float: false };
  // Drops with a numeric valueOf (rare) – Ruby would call to_number, otherwise 0.
  return { value: 0, float: false };
}

export function makeNumber(value: number, float: boolean): number | LiquidFloat {
  if (float) return new LiquidFloat(value);
  return value;
}

// ---- exact decimal helpers (BigDecimal emulation) -------------------------------------

interface Decimal {
  int: bigint;
  scale: number; // value = int / 10^scale
}

function toDecimal(value: number): Decimal {
  if (value === 0) return { int: 0n, scale: 0 };
  const exp = value.toExponential();
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(exp);
  if (!match) return { int: BigInt(Math.round(value)), scale: 0 };
  const sign = match[1] === '-' ? -1n : 1n;
  const digits = (match[2] as string) + (match[3] ?? '');
  const e = Number.parseInt(match[4] as string, 10);
  let scale = digits.length - 1 - e;
  let int = BigInt(digits) * sign;
  if (scale < 0) {
    int *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { int, scale };
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  const ai = a.int * 10n ** BigInt(scale - a.scale);
  const bi = b.int * 10n ** BigInt(scale - b.scale);
  return [ai, bi, scale];
}

function decimalToNumber(int: bigint, scale: number): number {
  if (scale === 0) return Number(int);
  const negative = int < 0n;
  let digits = (negative ? -int : int).toString();
  if (digits.length <= scale) digits = '0'.repeat(scale - digits.length + 1) + digits;
  const text = `${negative ? '-' : ''}${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
  return Number.parseFloat(text);
}

function exactAdd(a: number, b: number): number {
  const [ai, bi, scale] = align(toDecimal(a), toDecimal(b));
  return decimalToNumber(ai + bi, scale);
}

function exactSub(a: number, b: number): number {
  const [ai, bi, scale] = align(toDecimal(a), toDecimal(b));
  return decimalToNumber(ai - bi, scale);
}

function exactMul(a: number, b: number): number {
  const da = toDecimal(a);
  const db = toDecimal(b);
  return decimalToNumber(da.int * db.int, da.scale + db.scale);
}

function exactMod(a: number, b: number): number {
  const [ai, bi, scale] = align(toDecimal(a), toDecimal(b));
  let r = ai % bi;
  if (r !== 0n && (r < 0n) !== (bi < 0n)) r += bi;
  return decimalToNumber(r, scale);
}

export class ZeroDivision extends Error {
  constructor() {
    super('divided by 0');
  }
}

export type MathOp = 'plus' | 'minus' | 'times' | 'divided_by' | 'modulo';

/** Liquid's StandardFilters#apply_operation */
export function applyOperation(input: unknown, operand: unknown, op: MathOp): number | LiquidFloat {
  const a = toRubyNumber(input);
  const b = toRubyNumber(operand);
  const float = a.float || b.float;
  if (!float) {
    const x = a.value;
    const y = b.value;
    switch (op) {
      case 'plus':
        return x + y;
      case 'minus':
        return x - y;
      case 'times':
        return x * y;
      case 'divided_by':
        if (y === 0) throw new ZeroDivision();
        return Math.floor(x / y);
      case 'modulo': {
        if (y === 0) throw new ZeroDivision();
        const r = x % y;
        return r !== 0 && (r < 0) !== (y < 0) ? r + y : r;
      }
    }
  }
  const x = a.value;
  const y = b.value;
  switch (op) {
    case 'plus':
      return new LiquidFloat(exactAdd(x, y));
    case 'minus':
      return new LiquidFloat(exactSub(x, y));
    case 'times':
      return new LiquidFloat(exactMul(x, y));
    case 'divided_by':
      if (y === 0) throw new ZeroDivision();
      return new LiquidFloat(x / y);
    case 'modulo':
      if (y === 0) throw new ZeroDivision();
      return new LiquidFloat(exactMod(x, y));
  }
}

/** BigDecimal#round (ROUND_HALF_UP: half away from zero) */
function roundHalfUp(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const d = toDecimal(value);
  if (digits >= d.scale) return value;
  const drop = BigInt(d.scale - digits);
  const divisor = 10n ** drop;
  const negative = d.int < 0n;
  const abs = negative ? -d.int : d.int;
  let q = abs / divisor;
  const rem = abs % divisor;
  if (rem * 2n >= divisor) q += 1n;
  const signed = negative ? -q : q;
  if (digits >= 0) return decimalToNumber(signed, digits);
  return Number(signed * 10n ** BigInt(-digits));
}

export function liquidRound(input: unknown, places: unknown): number | LiquidFloat {
  const a = toRubyNumber(input);
  const n = toRubyNumber(places ?? 0).value;
  const digits = Math.trunc(n);
  if (digits === 0) {
    if (!a.float) return a.value;
    return Math.trunc(roundHalfUp(a.value, 0));
  }
  if (!a.float) {
    if (digits > 0) return a.value;
    return Math.trunc(roundHalfUp(a.value, digits));
  }
  return new LiquidFloat(roundHalfUp(a.value, digits));
}

export function liquidCeil(input: unknown): number {
  return Math.ceil(toRubyNumber(input).value);
}

export function liquidFloor(input: unknown): number {
  return Math.floor(toRubyNumber(input).value);
}

export function liquidAbs(input: unknown): number | LiquidFloat {
  const a = toRubyNumber(input);
  return makeNumber(Math.abs(a.value), a.float);
}

export function liquidAtLeast(input: unknown, min: unknown): number | LiquidFloat {
  const a = toRubyNumber(input);
  const b = toRubyNumber(min);
  const pick = b.value > a.value ? b : a;
  return makeNumber(pick.value, pick.float);
}

export function liquidAtMost(input: unknown, max: unknown): number | LiquidFloat {
  const a = toRubyNumber(input);
  const b = toRubyNumber(max);
  const pick = b.value < a.value ? b : a;
  return makeNumber(pick.value, pick.float);
}

/** Ruby Float#to_s */
export function rubyFloatToString(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const exp = x.toExponential();
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(exp);
  if (!match) return String(x);
  const sign = match[1] as string;
  const digits = (match[2] as string) + (match[3] ?? '');
  const e = Number.parseInt(match[4] as string, 10);
  if (e >= -4 && e < 16) {
    let intPart: string;
    let fracPart: string;
    if (e >= 0) {
      if (digits.length <= e + 1) {
        intPart = digits + '0'.repeat(e + 1 - digits.length);
        fracPart = '0';
      } else {
        intPart = digits.slice(0, e + 1);
        fracPart = digits.slice(e + 1);
      }
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-e - 1) + digits;
    }
    return `${sign}${intPart}.${fracPart}`;
  }
  const frac = digits.length > 1 ? digits.slice(1) : '0';
  return `${sign}${digits[0]}.${frac}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
}

/** Sum used by the `sum` filter (Ruby: to_number each, BigDecimal => float). */
export function liquidSum(values: unknown[]): number | LiquidFloat {
  let total: number | LiquidFloat = 0;
  for (const v of values) total = applyOperation(total, v, 'plus');
  return total;
}
