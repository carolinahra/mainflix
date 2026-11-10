import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { InvalidPasswordException } from '../shared/exceptions/index.js'
export class Passwords {
  private readonly dummyHash: string = `scrypt$00000000000000000000000000000000$${'00'.repeat(64)}`
  validate(password: string): void {
    if (typeof password !== 'string' || password.length < 6 || password.length > 128)
      throw new InvalidPasswordException()
  }
  private derive(password: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject): void => {
      scrypt(
        password,
        salt,
        64,
        { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
        (error: Error | null, key: Buffer): void => (error ? reject(error) : resolve(key)),
      )
    })
  }
  async hash(password: string): Promise<string> {
    this.validate(password)
    const salt: string = randomBytes(16).toString('hex')
    return `scrypt$${salt}$${(await this.derive(password, salt)).toString('hex')}`
  }
  async verify(password: string, encoded: string = this.dummyHash): Promise<boolean> {
    const [algorithm, salt, hex] = encoded.split('$')
    if (algorithm !== 'scrypt' || !salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false
    return timingSafeEqual(await this.derive(password, salt), Buffer.from(hex, 'hex'))
  }
  token(): string {
    return randomBytes(32).toString('base64url')
  }
  tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}
