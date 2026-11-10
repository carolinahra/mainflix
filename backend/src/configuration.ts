import { z } from 'zod'
import type { ContainerConfig } from './container.js'
export class Configuration {
  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): ContainerConfig {
    const databaseUrl: string = z
      .string()
      .regex(/^postgres(?:ql)?:\/\//)
      .parse(env.DATABASE_URL)
    const rawOrigin: string = z.string().url().parse(env.APP_ORIGIN)
    const origin: string = new URL(rawOrigin).origin
    if (origin !== rawOrigin || (env.NODE_ENV === 'production' && !origin.startsWith('https://')))
      throw new Error(
        'APP_ORIGIN must be an origin without a trailing slash; HTTPS is required in production',
      )
    return {
      databaseUrl,
      origin,
      secureCookies: env.NODE_ENV !== 'development',
      tmdbToken: env.TMDB_TOKEN ?? '',
    }
  }
}
