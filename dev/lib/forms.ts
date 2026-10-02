// The `form` object available inside {% form %} blocks.
import { BaseDrop } from './drop-base.ts';

const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  body: 'Body',
  name: 'Name',
  phone: 'Phone',
  password: 'Password',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' ');
}

export class FormErrorsDrop extends BaseDrop {
  #errors: Record<string, string>;

  constructor(errors: Record<string, string>) {
    super();
    this.#errors = errors;
  }

  get messages(): Record<string, string> {
    return { ...this.#errors };
  }

  get translated_fields(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const field of Object.keys(this.#errors)) out[field] = fieldLabel(field);
    return out;
  }

  get size(): number {
    return Object.keys(this.#errors).length;
  }

  get first(): string | null {
    return Object.keys(this.#errors)[0] ?? null;
  }

  /** lets `form.errors contains 'email'` work */
  indexOf(field: unknown): number {
    return Object.keys(this.#errors).indexOf(String(field));
  }

  *[Symbol.iterator](): Iterator<string> {
    yield* Object.keys(this.#errors);
  }

  fullMessages(): string[] {
    return Object.entries(this.#errors).map(([field, message]) => `${fieldLabel(field)} ${message}.`);
  }

  override toString(): string {
    return this.fullMessages().join(' ');
  }

  override toJSON(): unknown {
    return { ...this.#errors };
  }
}

export interface FormInit {
  type: string;
  id: string | null;
  postedSuccessfully: boolean;
  errors: Record<string, string> | null;
  values: Record<string, string>;
}

export class FormDrop extends BaseDrop {
  #init: FormInit;

  constructor(init: FormInit) {
    super();
    this.#init = init;
  }

  get 'posted_successfully?'(): boolean {
    return this.#init.postedSuccessfully;
  }

  get errors(): FormErrorsDrop | null {
    const e = this.#init.errors;
    return e && Object.keys(e).length ? new FormErrorsDrop(e) : null;
  }

  get id(): string | null {
    return this.#init.id;
  }

  get email(): string | null {
    return this.#init.values.email ?? null;
  }

  get body(): string | null {
    return this.#init.values.body ?? null;
  }

  get name(): string | null {
    return this.#init.values.name ?? null;
  }

  get phone(): string | null {
    return this.#init.values.phone ?? null;
  }

  get author(): string | null {
    return this.#init.values.author ?? null;
  }

  get password_needed(): boolean {
    return false;
  }

  override liquidMethodMissing(key: string | number): unknown {
    return this.#init.values[String(key)] ?? null;
  }

  override toString(): string {
    return 'FormDrop';
  }
}
