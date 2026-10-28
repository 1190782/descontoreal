/** Minimal logger for the collection engine; `console` satisfies it. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
