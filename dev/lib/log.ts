// Console logging for the emulator. Everything unsupported or broken is logged loudly.

const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

function paint(code: string, text: string): string {
  return useColor ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const colors = {
  red: (t: string): string => paint('31', t),
  green: (t: string): string => paint('32', t),
  yellow: (t: string): string => paint('33', t),
  cyan: (t: string): string => paint('36', t),
  dim: (t: string): string => paint('2', t),
  bold: (t: string): string => paint('1', t),
};

let quiet = false;
const onceKeys = new Set<string>();

export function setQuiet(value: boolean): void {
  quiet = value;
}

export function isQuiet(): boolean {
  return quiet;
}

export function info(message: string): void {
  if (!quiet) console.log(`${colors.cyan('[kuki-shop]')} ${message}`);
}

export function warn(message: string): void {
  if (!quiet) console.warn(`${colors.yellow('[kuki-shop] WARN')} ${message}`);
}

export function error(message: string): void {
  if (!quiet) console.error(`${colors.red('[kuki-shop] ERROR')} ${message}`);
}

/** Warn once per key (per process, reset when the theme changes). */
export function warnOnce(key: string, message: string): void {
  if (onceKeys.has(key)) return;
  onceKeys.add(key);
  warn(message);
}

export function resetOnce(): void {
  onceKeys.clear();
}

export function request(method: string, path: string, status: number, ms: number, note = ''): void {
  if (quiet) return;
  const statusText =
    status >= 500 ? colors.red(String(status)) : status >= 400 ? colors.yellow(String(status)) : colors.green(String(status));
  const time = ms >= 100 ? colors.yellow(`${ms.toFixed(0)}ms`) : colors.dim(`${ms.toFixed(1)}ms`);
  console.log(`${colors.dim(method.padEnd(4))} ${path} ${statusText} ${time}${note ? ' ' + note : ''}`);
}
