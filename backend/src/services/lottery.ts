import { randomInt } from 'node:crypto'
export class Lottery {
  constructor(private readonly pick: (size: number) => number = randomInt) {}
  index(size: number): number {
    return this.pick(size)
  }
}
