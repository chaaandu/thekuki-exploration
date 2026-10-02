// Base class for every Shopify object exposed to Liquid, plus Shopify `blank`/`empty` semantics.
import { Drop, Liquid } from 'liquidjs';

// LiquidJS does not export its literal drop classes; grab them from the literals themselves.
const probe = new Liquid();
const blankLiteral = probe.evalValueSync('blank', {}) as object;
const emptyLiteral = probe.evalValueSync('empty', {}) as object;
const nilLiteral = probe.evalValueSync('nil', {}) as object;

type AnyClass = abstract new (...args: never[]) => object;
const BlankDropClass = blankLiteral.constructor as AnyClass;
const EmptyDropClass = emptyLiteral.constructor as AnyClass;
const NullDropClass = nilLiteral.constructor as AnyClass;

export function isBlankLiteral(value: unknown): boolean {
  return value instanceof BlankDropClass;
}

export function isEmptyOrBlankLiteral(value: unknown): boolean {
  return value instanceof EmptyDropClass;
}

export function isNilLiteral(value: unknown): boolean {
  return value instanceof NullDropClass;
}

export class BaseDrop extends Drop {
  /** What Shopify prints for `{{ object }}` (e.g. "ProductDrop"). */
  toString(): string {
    return this.constructor.name;
  }

  /** Ruby `blank?`/`empty?` for this object (ActiveSupport: drops are not blank unless empty?). */
  isBlankValue(_kind: 'blank' | 'empty'): boolean {
    return false;
  }

  /** Two drops for the same store record compare equal. */
  identity(): unknown {
    return this;
  }

  toJSON(): unknown {
    return this.toString();
  }

  // LiquidJS Comparable protocol
  equals(other: unknown): boolean {
    if (isEmptyOrBlankLiteral(other)) return this.isBlankValue(isBlankLiteral(other) ? 'blank' : 'empty');
    if (other === null || other === undefined || isNilLiteral(other)) return false;
    if (other instanceof BaseDrop) return other === this || other.identity() === this.identity();
    return false;
  }

  gt(_other: unknown): boolean {
    return false;
  }

  geq(_other: unknown): boolean {
    return false;
  }

  lt(_other: unknown): boolean {
    return false;
  }

  leq(_other: unknown): boolean {
    return false;
  }
}

// `blank == drop` / `drop == blank` must ask the drop (LiquidJS would test Object.keys(drop)).
type GenEquals = (this: unknown, value: unknown) => Generator<unknown, boolean, unknown>;
const emptyProto = EmptyDropClass.prototype as unknown as { equals: GenEquals; __kukiPatched?: boolean };
if (!emptyProto.__kukiPatched) {
  const originalEquals = emptyProto.equals;
  emptyProto.equals = function* (this: unknown, value: unknown): Generator<unknown, boolean, unknown> {
    if (value instanceof BaseDrop) return value.isBlankValue(isBlankLiteral(this) ? 'blank' : 'empty');
    return yield* originalEquals.call(this, value);
  };
  emptyProto.__kukiPatched = true;
}
