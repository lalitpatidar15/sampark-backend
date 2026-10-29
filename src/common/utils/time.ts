export const now = () => new Date();

export const addSeconds = (seconds: number, from: Date = new Date()): Date =>
  new Date(from.getTime() + seconds * 1000);

export const addMinutes = (minutes: number, from: Date = new Date()): Date =>
  new Date(from.getTime() + minutes * 60 * 1000);

export const addHours = (hours: number, from: Date = new Date()): Date =>
  new Date(from.getTime() + hours * 60 * 60 * 1000);

export const addDays = (days: number, from: Date = new Date()): Date =>
  new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

export const isExpired = (date: Date | null | undefined): boolean =>
  !!date && date.getTime() <= Date.now();

export const minutesBetween = (a: Date, b: Date): number =>
  Math.floor((b.getTime() - a.getTime()) / 60_000);
