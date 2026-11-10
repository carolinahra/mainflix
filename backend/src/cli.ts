import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { Container } from './container.js'
import { Configuration } from './configuration.js'
import type { User, ResetToken } from './models/entities.js'

export class PasswordPrompt {
  async read(): Promise<string> {
    if (process.env.MAINFLIX_PASSWORD) return process.env.MAINFLIX_PASSWORD
    if (!process.stdin.isTTY)
      throw new Error(
        'Provide MAINFLIX_PASSWORD through the environment for noninteractive provisioning',
      )
    process.stdout.write('Password (12–128 characters): ')
    return new Promise((resolve, reject): void => {
      let password: string = ''
      process.stdin.setRawMode(true)
      process.stdin.resume()
      const done = (error?: Error): void => {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdin.off('data', input)
        process.stdout.write('\n')
        if (error) reject(error)
        else resolve(password)
      }
      const input = (buffer: Buffer): void => {
        for (const char of buffer.toString('utf8')) {
          if (char === '\u0003') {
            done(new Error('Cancelled'))
            return
          }
          if (char === '\r' || char === '\n') {
            done()
            return
          }
          if (char === '\u007f' || char === '\b') password = password.slice(0, -1)
          else password += char
        }
      }
      process.stdin.on('data', input)
    })
  }
}
export class Cli {
  constructor(
    private readonly container: Container,
    private readonly prompt: PasswordPrompt,
  ) {}
  async run(args: string[]): Promise<void> {
    const { positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        email: { type: 'string' },
        username: { type: 'string' },
        name: { type: 'string' },
        admin: { type: 'boolean', default: false },
      },
    })
    const command: string | undefined = positionals[0]
    if (command === 'migrate') {
      await this.container.database.migrate(
        await Promise.all(
          ['001_initial.sql', '002_usernames.sql', '003_optional_email.sql'].map((file) =>
            readFile(new URL(`../../db/${file}`, import.meta.url), 'utf8'),
          ),
        ),
      )
      console.log('Migrations applied')
      return
    }
    if (command === 'create-user' && values.username && values.name) {
      const user: User = await this.container.userService.create(
        values.email ?? null,
        values.username,
        values.name,
        await this.prompt.read(),
        values.admin,
      )
      console.log(
        `Created ${user.username}${user.email ? ` (${user.email})` : ''}${user.is_admin ? ' (admin)' : ''}`,
      )
      return
    }
    if (command === 'reset-password' && Boolean(values.username) !== Boolean(values.email)) {
      const user: User | undefined = (await this.container.userService.list()).find((u) =>
        values.username
          ? u.username === values.username.trim().toLowerCase()
          : u.email === values.email?.trim().toLowerCase(),
      )
      if (!user) throw new Error('User not found')
      const reset: ResetToken = await this.container.userService.issueReset(user.id)
      console.log(
        `Private reset link (expires ${reset.expiresAt.toISOString()}): ${this.container.config.origin}/#reset=${reset.token}`,
      )
      return
    }
    throw new Error(
      'Usage: migrate | create-user --username USERNAME --name NAME [--email EMAIL] [--admin] | reset-password (--username USERNAME | --email EMAIL)',
    )
  }
  static async main(): Promise<void> {
    const container: Container = new Container(Configuration.fromEnvironment())
    try {
      await new Cli(container, new PasswordPrompt()).run(process.argv.slice(2))
    } catch (error: unknown) {
      console.error(error instanceof Error ? error.message : 'Command failed')
      process.exitCode = 1
    } finally {
      await container.close()
    }
  }
}
await Cli.main()
