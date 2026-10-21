export const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
export type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

/** One message from the snippet's console. `text` comes from untrusted code: render it as text only. */
export interface ConsoleEntry {
  id: number;
  level: ConsoleLevel;
  text: string;
  /** epoch ms when the parent received it */
  time: number;
}
