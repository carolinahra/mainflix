export class Clock {
  constructor(private readonly read: () => Date = (): Date => new Date()) {}
  now(): Date {
    return this.read()
  }
  weekKey(now: Date = this.now()): string {
    const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    const year: number = Number(parts.find((p) => p.type === 'year')!.value)
    const month: number = Number(parts.find((p) => p.type === 'month')!.value)
    const day: number = Number(parts.find((p) => p.type === 'day')!.value)
    const date: Date = new Date(Date.UTC(year, month - 1, day))
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
    return date.toISOString().slice(0, 10)
  }
}
