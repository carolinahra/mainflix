import type { Request, Response } from 'express'
import type { ParsedQs } from 'qs'
import type { User, Language } from '../models/entities.js'
import { z } from 'zod'
import { AuthenticationRequiredException } from './exceptions/index.js'
export type HttpRequest = Request<Record<string, string>, unknown, unknown, ParsedQs>
export type HttpResponse = Response<unknown, { user?: User }>
export class Http {
  static readonly id = z.coerce.number().int().positive().max(2147483647)
  static readonly week = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  static readonly pagination = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  static user(res: HttpResponse): User {
    if (!res.locals.user) throw new AuthenticationRequiredException()
    return res.locals.user
  }
  static language(req: HttpRequest): Language {
    return z.enum(['en', 'es']).default('en').parse(req.query.language)
  }
}
