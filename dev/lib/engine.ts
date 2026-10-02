// LiquidJS configured to behave like Shopify Liquid.
import {
  Liquid,
  LiquidError,
  Tokenizer,
  defaultOperators,
  isTruthy,
  toValue,
  type Context,
  type Emitter,
  type Operators,
  type Template,
} from 'liquidjs';
import { isEmptyOrBlankLiteral, isNilLiteral } from './drop-base.ts';
import * as log from './log.ts';
import { LiquidFloat, rubyInspect } from './numbers.ts';
import { tryGetState, type LiquidErrorRecord } from './state.ts';
import { escapeHtml, isPlainObject } from './util.ts';

// ---- errors -------------------------------------------------------------------------------

/** An error that knows which theme file/line it belongs to (syntax errors, missing files). */
export class KukiLiquidError extends Error {
  readonly file: string | null;
  readonly line: number | null;
  readonly kind: 'error' | 'syntax';

  constructor(message: string, file: string | null = null, line: number | null = null, kind: 'error' | 'syntax' = 'error') {
    super(message);
    this.file = file;
    this.line = line;
    this.kind = kind;
  }
}

function stripPosition(message: string): string {
  return message.replace(/(, file:[^,]*)?, line:\d+, col:\d+$/, '').trim();
}

export function describeError(err: unknown, fallbackToken?: { file?: string; getPosition(): number[] }): LiquidErrorRecord {
  let file: string | null = null;
  let line: number | null = null;
  let kind: 'error' | 'syntax' = 'error';
  let message: string;
  if (err instanceof KukiLiquidError) {
    file = err.file;
    line = err.line;
    kind = err.kind;
    message = err.message;
  } else {
    const e = err as { message?: string; originalError?: { message?: string }; token?: { file?: string; getPosition(): number[] }; name?: string };
    message = stripPosition(e?.originalError?.message ?? e?.message ?? String(err));
    const token = LiquidError.is(err) && e.token ? e.token : fallbackToken;
    if (token) {
      file = token.file ?? null;
      line = token.getPosition()[0] ?? null;
    }
    if (e?.name === 'ParseError' || e?.name === 'TokenizationError') kind = 'syntax';
  }
  const where = file ? `${file} line ${line ?? '?'}` : `line ${line ?? '?'}`;
  const text = `Liquid ${kind === 'syntax' ? 'syntax error' : 'error'} (${where}): ${message}`;
  return { kind, file, line, message, text };
}

export function errorBoxHtml(record: LiquidErrorRecord): string {
  return (
    '<div class="kuki-liquid-error" data-kuki-liquid-error role="alert" style="display:block;box-sizing:border-box;' +
    'margin:6px;padding:8px 12px;border:3px solid #d00;background:#fff0f0;color:#a00;font:600 13px/1.45 ui-monospace,monospace;' +
    `white-space:pre-wrap;text-align:left;position:relative;z-index:2147483647">${escapeHtml(record.text)}</div>`
  );
}

/** Record + log an error for the current request (deduplicated per request). */
export function reportError(ctx: Context | undefined, record: LiquidErrorRecord): void {
  const state = tryGetState(ctx);
  if (state) {
    if (!state.errors.some((e) => e.text === record.text)) {
      state.errors.push(record);
      log.error(`${record.text}  [${state.request.method} ${state.request.path}]`);
    }
  } else {
    log.error(record.text);
  }
}

// ---- output helpers ---------------------------------------------------------------------

/** LiquidJS's stringify: drops via valueOf, nil => '', arrays concatenated. */
export function liquidToString(value: unknown): string {
  const v = toValue(value);
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map((x) => liquidToString(x)).join('');
  return String(v);
}

export class BufferEmitter implements Emitter {
  buffer = '';

  write(html: unknown): void {
    this.buffer += liquidToString(html);
  }
}

/** Shopify converts the `blank`/`empty` literals to '' and `nil` to nil when stored in variables. */
export function toStoredValue(value: unknown): unknown {
  if (isEmptyOrBlankLiteral(value)) return '';
  if (isNilLiteral(value)) return null;
  return value;
}

// ---- operators ----------------------------------------------------------------------------

function isComparable(v: unknown): v is { gt(o: unknown): unknown; lt(o: unknown): unknown; geq(o: unknown): unknown; leq(o: unknown): unknown } {
  const x = v as Record<string, unknown> | null;
  return (
    !!x &&
    typeof x === 'object' &&
    typeof x.equals === 'function' &&
    typeof x.gt === 'function' &&
    typeof x.lt === 'function' &&
    typeof x.geq === 'function' &&
    typeof x.leq === 'function'
  );
}

type CmpOp = 'gt' | 'lt' | 'geq' | 'leq';
const MIRROR: Record<CmpOp, CmpOp> = { gt: 'lt', lt: 'gt', geq: 'leq', leq: 'geq' };

function rubyClass(v: unknown): string {
  if (typeof v === 'string') return 'String';
  if (typeof v === 'number') return Number.isInteger(v) ? 'Integer' : 'Float';
  if (v instanceof LiquidFloat) return 'Float';
  if (typeof v === 'boolean') return v ? 'TrueClass' : 'FalseClass';
  if (Array.isArray(v)) return 'Array';
  return 'Object';
}

function* compare(lhs: unknown, rhs: unknown, op: CmpOp): Generator<unknown, boolean, unknown> {
  if (isComparable(lhs)) return Boolean(yield (lhs[op] as (o: unknown) => unknown).call(lhs, rhs));
  if (isComparable(rhs)) return Boolean(yield (rhs[MIRROR[op]] as (o: unknown) => unknown).call(rhs, lhs));
  const l = toValue(lhs);
  const r = toValue(rhs);
  if (l === null || l === undefined || r === null || r === undefined) return false;
  const bothNumbers = typeof l === 'number' && typeof r === 'number';
  const bothStrings = typeof l === 'string' && typeof r === 'string';
  if (bothNumbers || bothStrings) {
    const a = l as number | string;
    const b = r as number | string;
    switch (op) {
      case 'gt':
        return a > b;
      case 'lt':
        return a < b;
      case 'geq':
        return a >= b;
      case 'leq':
        return a <= b;
    }
  }
  const comparableTypes = (x: unknown): boolean => typeof x === 'number' || typeof x === 'string';
  if (comparableTypes(l) && comparableTypes(r)) {
    const detail = typeof l === 'string' ? rubyInspect(r) : rubyClass(r);
    throw new Error(`comparison of ${rubyClass(l)} with ${detail} failed`);
  }
  return false;
}

function* contains(lhs: unknown, rhs: unknown): Generator<unknown, boolean, unknown> {
  const l = toValue(lhs);
  const r = toValue(rhs);
  if (l === null || l === undefined || l === false || r === null || r === undefined || r === false) return false;
  if (typeof l === 'string') return l.includes(liquidToString(r));
  if (Array.isArray(l)) {
    const eq = defaultOperators['=='] as (a: unknown, b: unknown) => Generator<unknown, boolean, unknown>;
    for (const item of l) {
      if (yield* eq(item, r)) return true;
    }
    return false;
  }
  const withIndexOf = l as { indexOf?: (x: unknown) => number };
  if (typeof withIndexOf.indexOf === 'function') return withIndexOf.indexOf(r) > -1;
  if (isPlainObject(l)) return Object.prototype.hasOwnProperty.call(l, liquidToString(r));
  return false;
}

export const shopifyOperators: Operators = {
  '==': defaultOperators['=='] as Operators[string],
  '!=': defaultOperators['!='] as Operators[string],
  '<>': defaultOperators['!='] as Operators[string],
  '>': (l: unknown, r: unknown) => compare(l, r, 'gt'),
  '<': (l: unknown, r: unknown) => compare(l, r, 'lt'),
  '>=': (l: unknown, r: unknown) => compare(l, r, 'geq'),
  '<=': (l: unknown, r: unknown) => compare(l, r, 'leq'),
  contains: (l: unknown, r: unknown) => contains(l, r),
  and: function* (l: unknown, r: unknown, ctx: Context): Generator<unknown, boolean, unknown> {
    return isTruthy(toValue(l), ctx) && isTruthy(toValue(r), ctx);
  },
  or: function* (l: unknown, r: unknown, ctx: Context): Generator<unknown, boolean, unknown> {
    return isTruthy(toValue(l), ctx) || isTruthy(toValue(r), ctx);
  },
  not: () => {
    throw new Error("'not' is not a Shopify Liquid operator (use unless, or != / == false)");
  },
};

// ---- global LiquidJS patches ------------------------------------------------------------

interface NumberTokenLike {
  content: unknown;
  getText(): string;
}

let floatPatchInstalled = false;

/** Number literals written with a decimal point are Ruby Floats (`2.0` stays a float). */
function installFloatLiterals(): void {
  if (floatPatchInstalled) return;
  floatPatchInstalled = true;
  const proto = Tokenizer.prototype as unknown as { readNumber: (this: Tokenizer) => NumberTokenLike | undefined };
  const original = proto.readNumber;
  proto.readNumber = function (this: Tokenizer): NumberTokenLike | undefined {
    const token = original.call(this);
    if (token && token.getText().includes('.')) token.content = new LiquidFloat(Number(token.getText()));
    return token;
  };
}

type RenderTemplates = (templates: Template[], ctx: Context, emitter?: Emitter) => Generator<unknown, string, unknown>;

/** Every template node renders independently: an error becomes an inline box at its spot. */
function installInlineErrors(liquid: Liquid): void {
  const renderer = liquid.renderer as unknown as { renderTemplates: RenderTemplates };
  renderer.renderTemplates = function* (templates: Template[], ctx: Context, emitter?: Emitter): Generator<unknown, string, unknown> {
    const out: Emitter = emitter ?? new BufferEmitter();
    for (const tpl of templates) {
      try {
        const html = yield tpl.render(ctx, out);
        if (html) out.write(html);
        if (ctx.breakCalled || ctx.continueCalled) break;
      } catch (err) {
        const record = describeError(err, tpl.token);
        reportError(ctx, record);
        out.write(errorBoxHtml(record));
      }
    }
    return out.buffer;
  };
}

export function createLiquid(extra: { partials?: string[]; cache?: boolean } = {}): Liquid {
  installFloatLiterals();
  const liquid = new Liquid({
    cache: extra.cache ?? false,
    partials: extra.partials,
    root: extra.partials,
    extname: '.liquid',
    strictFilters: false,
    strictVariables: false,
    ownPropertyOnly: true,
    jsTruthy: false,
    greedy: true,
    dynamicPartials: true,
    relativeReference: false,
    operators: shopifyOperators,
  });
  installInlineErrors(liquid);
  return liquid;
}
