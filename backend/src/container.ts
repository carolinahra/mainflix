import { Database } from './repositories/database.js'
import { UserRepository } from './repositories/user.repository.js'
import { MovieRepository } from './repositories/movie.repository.js'
import { RoundRepository } from './repositories/round.repository.js'
import { ReviewRepository } from './repositories/review.repository.js'
import { UserService } from './services/user.service.js'
import { MovieService } from './services/movie.service.js'
import { RoundService } from './services/round.service.js'
import { ReviewService } from './services/review.service.js'
import { Clock } from './services/clock.js'
import { Lottery } from './services/lottery.js'
import { Passwords } from './services/passwords.js'
import { Tmdb } from './services/tmdb.js'
import { ExceptionService } from './shared/exception.service.js'
import { Application } from './application.js'
import { AuthController } from './controllers/auth.controller.js'
import { RoundController } from './controllers/round.controller.js'
import { MovieController } from './controllers/movie.controller.js'
import { AdminController } from './controllers/admin.controller.js'
import { AuthMiddleware } from './shared/auth.middleware.js'

export interface ContainerConfig {
  databaseUrl: string
  origin: string
  secureCookies: boolean
  tmdbToken: string
}
interface ContainerProps {
  database?: Database
  clock?: Clock
  lottery?: Lottery
  passwords?: Passwords
  tmdb?: Tmdb
  userRepository?: UserRepository
  movieRepository?: MovieRepository
  roundRepository?: RoundRepository
  reviewRepository?: ReviewRepository
  userService?: UserService
  movieService?: MovieService
  roundService?: RoundService
  reviewService?: ReviewService
  exceptionService?: ExceptionService
  application?: Application
  authMiddleware?: AuthMiddleware
  authController?: AuthController
  roundController?: RoundController
  movieController?: MovieController
  adminController?: AdminController
}
export class Container {
  private readonly props: ContainerProps = {}
  constructor(readonly config: ContainerConfig) {}
  get database(): Database {
    return (this.props.database ??= Database.connect(this.config.databaseUrl))
  }
  set database(value: Database) {
    this.props.database = value
  }
  get clock(): Clock {
    return (this.props.clock ??= new Clock())
  }
  set clock(value: Clock) {
    this.props.clock = value
  }
  get lottery(): Lottery {
    return (this.props.lottery ??= new Lottery())
  }
  set lottery(value: Lottery) {
    this.props.lottery = value
  }
  get passwords(): Passwords {
    return (this.props.passwords ??= new Passwords())
  }
  get tmdb(): Tmdb {
    return (this.props.tmdb ??= new Tmdb(this.config.tmdbToken))
  }
  set tmdb(value: Tmdb) {
    this.props.tmdb = value
  }
  get userRepository(): UserRepository {
    return (this.props.userRepository ??= new UserRepository(this.database))
  }
  get movieRepository(): MovieRepository {
    return (this.props.movieRepository ??= new MovieRepository(this.database))
  }
  get roundRepository(): RoundRepository {
    return (this.props.roundRepository ??= new RoundRepository(this.database))
  }
  get reviewRepository(): ReviewRepository {
    return (this.props.reviewRepository ??= new ReviewRepository(this.database))
  }
  get userService(): UserService {
    return (this.props.userService ??= new UserService(
      this.database,
      this.userRepository,
      this.clock,
      this.passwords,
    ))
  }
  get movieService(): MovieService {
    return (this.props.movieService ??= new MovieService(
      this.database,
      this.movieRepository,
      this.roundRepository,
      this.tmdb,
      this.clock,
    ))
  }
  get roundService(): RoundService {
    return (this.props.roundService ??= new RoundService(
      this.database,
      this.roundRepository,
      this.movieRepository,
      this.clock,
      this.lottery,
    ))
  }
  get reviewService(): ReviewService {
    return (this.props.reviewService ??= new ReviewService(
      this.reviewRepository,
      this.movieRepository,
      this.clock,
    ))
  }
  get exceptionService(): ExceptionService {
    return (this.props.exceptionService ??= new ExceptionService())
  }
  get authMiddleware(): AuthMiddleware {
    return (this.props.authMiddleware ??= new AuthMiddleware(this.userService, this.config))
  }
  get authController(): AuthController {
    return (this.props.authController ??= new AuthController(
      this.userService,
      this.authMiddleware,
      this.config,
    ))
  }
  get roundController(): RoundController {
    return (this.props.roundController ??= new RoundController(this.roundService))
  }
  get movieController(): MovieController {
    return (this.props.movieController ??= new MovieController(
      this.movieService,
      this.reviewService,
    ))
  }
  get adminController(): AdminController {
    return (this.props.adminController ??= new AdminController(
      this.movieService,
      this.userService,
      this.config,
    ))
  }
  get application(): Application {
    return (this.props.application ??= new Application(this))
  }
  async close(): Promise<void> {
    await this.props.database?.close()
  }
}
