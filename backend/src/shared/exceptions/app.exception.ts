export abstract class AppException extends Error {
  abstract readonly code: string
  abstract readonly statusCode: number
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}
