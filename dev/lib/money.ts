// Shopify money formatting ({{amount}} placeholders, amounts in subunits).
import { toRubyNumber } from './numbers.ts';

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/;

function groupThousands(intDigits: string, sep: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

function formatNumber(cents: number, decimals: number, thousands: string, decimal: string): string {
  const negative = cents < 0;
  const value = Math.abs(cents) / 100;
  const fixed = value.toFixed(decimals);
  const [intPart, frac] = fixed.split('.');
  const grouped = groupThousands(intPart ?? '0', thousands);
  const body = decimals > 0 ? `${grouped}${decimal}${frac ?? ''}` : grouped;
  return negative ? `-${body}` : body;
}

export function formatAmount(cents: number, placeholder: string): string {
  switch (placeholder) {
    case 'amount':
      return formatNumber(cents, 2, ',', '.');
    case 'amount_no_decimals':
      return formatNumber(cents, 0, ',', '.');
    case 'amount_with_comma_separator':
      return formatNumber(cents, 2, '.', ',');
    case 'amount_no_decimals_with_comma_separator':
      return formatNumber(cents, 0, '.', ',');
    case 'amount_with_apostrophe_separator':
      return formatNumber(cents, 2, "'", '.');
    case 'amount_no_decimals_with_space_separator':
      return formatNumber(cents, 0, ' ', ',');
    case 'amount_with_space_separator':
      return formatNumber(cents, 2, ' ', ',');
    case 'amount_with_period_and_space_separator':
      return formatNumber(cents, 2, ' ', '.');
    default:
      throw new Error(`money: unknown money format placeholder {{${placeholder}}}`);
  }
}

const NO_DECIMALS: Record<string, string> = {
  amount: 'amount_no_decimals',
  amount_with_comma_separator: 'amount_no_decimals_with_comma_separator',
  amount_with_space_separator: 'amount_no_decimals_with_space_separator',
  amount_with_period_and_space_separator: 'amount_no_decimals_with_space_separator',
};

function toCents(input: unknown): number | null {
  if (input === null || input === undefined || input === '') return null;
  const n = toRubyNumber(input);
  return Math.round(n.value);
}

/** Format `cents` with a Shopify money format string such as "Rs. {{amount}}". */
export function formatMoney(input: unknown, format: string, opts: { stripZeros?: boolean } = {}): string {
  const cents = toCents(input);
  if (cents === null) return '';
  const match = PLACEHOLDER.exec(format);
  if (!match) return format;
  let placeholder = match[1] as string;
  if (opts.stripZeros && cents % 100 === 0) placeholder = NO_DECIMALS[placeholder] ?? placeholder;
  let formatted = formatAmount(cents, placeholder);
  if (opts.stripZeros && placeholder === 'amount_with_apostrophe_separator' && cents % 100 === 0) {
    formatted = formatted.replace(/\.00$/, '');
  }
  if (cents < 0) {
    const positive = format.replace(PLACEHOLDER, formatted.slice(1));
    return `-${positive}`;
  }
  return format.replace(PLACEHOLDER, formatted);
}

/** Only the number part of the format ("199.00"). */
export function formatMoneyWithoutCurrency(input: unknown, format: string): string {
  const match = PLACEHOLDER.exec(format);
  return formatMoney(input, match ? match[0] : '{{amount}}');
}
