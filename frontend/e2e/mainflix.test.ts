import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium, devices, type Browser, type Page } from 'playwright'
import { sql } from 'kysely'
import { Container } from '../../backend/src/container.js'
import { Database } from '../../backend/src/repositories/database.js'

class BrowserFixture {
  readonly database: Database = Database.connect(
    process.env.E2E_DATABASE_URL ??
      'postgres://mainflix:mainflix@localhost:55433/mainflix_smoke_test',
  )
  readonly container: Container = new Container({
    databaseUrl: 'unused',
    origin: process.env.E2E_ORIGIN ?? 'http://localhost:5173',
    secureCookies: false,
    tmdbToken: '',
  })
  browser: Browser | undefined
  constructor() {
    this.container.database = this.database
  }
  async prepare(): Promise<void> {
    const result = await sql<{ name: string }>`SELECT current_database() AS name`.execute(
      this.database.client,
    )
    assert.ok(result.rows[0]?.name.endsWith('_test'), 'Refusing to reset a non-test database')
    await this.database.migrate(
      await Promise.all(
        [
          '001_initial.sql',
          '002_usernames.sql',
          '003_optional_email.sql',
          '004_half_point_reviews.sql',
          '005_profiles_favorites.sql',
          '006_groups.sql',
          '007_anonymous_nominations_survey.sql',
        ].map((file) => readFile(new URL(`../../db/${file}`, import.meta.url), 'utf8')),
      ),
    )
    await sql`TRUNCATE users,movies,rounds,groups,rate_limits RESTART IDENTITY CASCADE`.execute(
      this.database.client,
    )
    await this.database.client
      .insertInto('groups')
      .values({ name: 'Mainflix', owner_id: null })
      .execute()
    await this.container.userService.create(
      'admin@example.com',
      'admin',
      'Admin',
      'Browser test password!',
      true,
    )
    for (let n = 1; n <= 4; n++)
      await this.container.userService.create(
        `friend${n}@example.com`,
        `friend${n}`,
        `Friend${n}`,
        'Browser test password!',
        false,
      )
    await this.database.client
      .insertInto('movies')
      .values([
        { title: 'Smoke Film A', approval_status: 'approved', release_year: 2020 },
        { title: 'Smoke Film B', approval_status: 'approved', release_year: 2021 },
      ])
      .execute()
    this.browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    })
  }
  async page(mobile: boolean = false): Promise<Page> {
    assert.ok(this.browser)
    const context = await this.browser.newContext(
      mobile ? { ...devices['iPhone SE (3rd gen)'] } : { viewport: { width: 1280, height: 900 } },
    )
    await context.addInitScript(() => localStorage.setItem('mainflix-language', 'en'))
    const page = await context.newPage()
    await page.goto(this.container.config.origin)
    return page
  }
  async login(page: Page, email: string): Promise<void> {
    await page.getByLabel('Username or email', { exact: true }).fill(email.split('@')[0]!)
    await page.getByLabel('Password', { exact: true }).fill('Browser test password!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('button', { name: 'Mainflix', exact: true }).click()
    await page.locator('.group-toolbar').waitFor()
  }
  async profile(page: Page): Promise<void> {
    await page.locator('.profile-menu > summary').click()
    await page.getByRole('button', { name: 'Go to my profile', exact: true }).click()
  }
  async close(): Promise<void> {
    await this.browser?.close()
    await this.container.close()
  }
}

test(
  'avatar menu fills its circle and header controls do not overlap at responsive sizes',
  { timeout: 60_000 },
  async () => {
    const f = new BrowserFixture()
    try {
      await f.prepare()
      const page = await f.page()
      await f.login(page, 'admin')
      const summary = page.locator('.profile-menu > summary')
      assert.equal(await summary.locator('img').getAttribute('src'), '/art/creeper-avatar.png')
      for (const language of ['en', 'es']) {
        await page.getByLabel('Language / Idioma').selectOption(language)
        for (const width of [320, 375, 760, 800, 1024, 1100, 1280, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          const overlaps = await page.locator('header').evaluate((header) => {
            const controls = [
              ...header.querySelectorAll('.brand, nav button, select, .profile-menu > summary'),
            ].map((element) => element.getBoundingClientRect())
            return controls.some((a, index) =>
              controls
                .slice(index + 1)
                .some(
                  (b) =>
                    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
                    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5,
                ),
            )
          })
          assert.equal(overlaps, false, `${language} header controls overlap at ${width}px`)
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
          )
        }
      }
      await page.getByLabel('Language / Idioma').selectOption('en')
      await summary.click()
      await page.getByRole('button', { name: 'Go to my profile', exact: true }).waitFor()
      assert.equal(await page.locator('.profile-page').count(), 0)
      await page.getByRole('button', { name: 'Go to my profile', exact: true }).click()
      await page.getByRole('heading', { name: 'My profile', exact: true }).waitFor()
      assert.equal(await page.locator('.profile-menu[open]').count(), 0)
      assert.equal(
        await page.getByRole('img', { name: 'Profile photo', exact: true }).getAttribute('src'),
        '/art/creeper-avatar.png',
      )
      await summary.focus()
      await summary.press('Enter')
      await page.getByRole('button', { name: 'Go to my profile', exact: true }).waitFor()
      await summary.press('Escape')
      assert.equal(await page.locator('.profile-menu[open]').count(), 0)
      const fillsCircle = await summary.evaluate((element) => {
        const circle = element.getBoundingClientRect()
        const image = element.querySelector('img')!.getBoundingClientRect()
        return (
          getComputedStyle(element).borderRadius === '50%' &&
          image.width >= circle.width - 4 &&
          image.height >= circle.height - 4
        )
      })
      assert.equal(fillsCircle, true)
      await summary.click()
      await page.screenshot({
        path: '/tmp/mainflix-avatar-menu-desktop.png',
        clip: { x: 0, y: 0, width: 1440, height: 220 },
      })
      await page.setViewportSize({ width: 320, height: 568 })
      await page.screenshot({
        path: '/tmp/mainflix-avatar-menu-mobile.png',
        clip: { x: 0, y: 0, width: 320, height: 220 },
      })
    } finally {
      await f.close()
    }
  },
)

test(
  'past weekly movies stay on home until the last voter reviews them',
  { timeout: 60_000 },
  async () => {
    const f = new BrowserFixture()
    try {
      await f.prepare()
      const users = await f.database.client.selectFrom('users').selectAll().orderBy('id').execute()
      const admin = users.find((user) => user.is_admin)!
      const voters = users.filter((user) => !user.is_admin)
      const movie = await f.database.client
        .selectFrom('movies')
        .selectAll()
        .where('title', '=', 'Smoke Film A')
        .executeTakeFirstOrThrow()
      const previousWeek = f.container.clock.weekKey(new Date(Date.now() - 7 * 86400000))
      await f.database.client
        .insertInto('rounds')
        .values({
          week_start: previousWeek,
          winner_id: movie.id,
          drawn_by: admin.id,
          drawn_at: new Date(),
        })
        .execute()
      await f.database.client
        .updateTable('movies')
        .set({ eligible: false })
        .where('id', '=', movie.id)
        .execute()
      for (const user of [admin, ...voters.slice(0, 3)]) {
        await f.container.reviewService.markWatched(user.id, movie.id)
        await f.container.reviewService.save(user.id, movie.id, 3.5, 'Already rated')
      }
      const page = await f.page()
      await f.login(page, 'friend1')
      const section = page.locator('[aria-labelledby="to-review-title"]')
      await section.getByRole('heading', { name: 'To be reviewed', exact: true }).waitFor()
      await section.getByRole('button', { name: 'Smoke Film A', exact: true }).waitFor()
      assert.equal(await page.locator('.winner').count(), 0)
      await page.reload()
      await page.getByRole('button', { name: 'Mainflix', exact: true }).click()
      await section.getByRole('button', { name: 'Smoke Film A', exact: true }).waitFor()
      await section.screenshot({ path: '/tmp/mainflix-to-review-desktop.png' })
      await page.setViewportSize({ width: 320, height: 568 })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await section.screenshot({ path: '/tmp/mainflix-to-review-mobile.png' })
      const last = await f.page()
      await f.login(last, 'friend4')
      await last
        .locator('[aria-labelledby="to-review-title"]')
        .getByRole('button', { name: 'Rate movie', exact: true })
        .click()
      const dialog = last.getByRole('dialog')
      await dialog.getByRole('button', { name: "I've watched it", exact: true }).click()
      await dialog.getByRole('radio', { name: '4.5/5', exact: true }).check()
      await dialog.getByRole('button', { name: 'Save review', exact: true }).click()
      await dialog.locator('.review [aria-label="4.5/5"]').waitFor()
      await dialog.getByRole('button', { name: 'Close ×', exact: true }).click()
      await last
        .getByRole('heading', { name: 'To be reviewed', exact: true })
        .waitFor({ state: 'hidden' })
      await section.waitFor({ state: 'hidden', timeout: 10_000 })
    } finally {
      await f.close()
    }
  },
)

test(
  'profile edits, photo uploads, private reviews, favorites, and password changes persist',
  { timeout: 90_000 },
  async () => {
    const f = new BrowserFixture()
    try {
      await f.prepare()
      const second = await f.database.client
        .selectFrom('users')
        .select('id')
        .where('username', '=', 'friend2')
        .executeTakeFirstOrThrow()
      const movie = await f.database.client
        .selectFrom('movies')
        .select('id')
        .where('title', '=', 'Smoke Film A')
        .executeTakeFirstOrThrow()
      await f.container.reviewService.markWatched(second.id, movie.id)
      await f.container.reviewService.save(second.id, movie.id, 2, 'Someone else review')
      const page = await f.page()
      await f.login(page, 'friend1')
      await f.profile(page)
      await page.getByLabel('Display name', { exact: true }).fill('Luna')
      await page.getByLabel('Username', { exact: true }).fill('luna')
      await page.getByRole('button', { name: 'Save profile', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'Profile saved.' }).waitFor()
      await page.getByLabel('Profile photo', { exact: true }).setInputFiles({
        name: 'diamond.png',
        mimeType: 'image/png',
        buffer: await readFile(new URL('../public/art/diamond.png', import.meta.url)),
      })
      await page.locator('.profile-photo > img[src^="data:image/webp"]').waitFor()
      const avatar = await page.locator('.profile-photo > img').getAttribute('src')
      assert.ok(avatar?.startsWith('data:image/webp;base64,'))
      assert.equal(await page.locator('.profile-menu summary img').getAttribute('src'), avatar)
      await page.reload()
      await page.getByRole('button', { name: 'Mainflix', exact: true }).click()
      await f.profile(page)
      assert.equal(await page.getByLabel('Username', { exact: true }).inputValue(), 'luna')
      assert.equal(await page.locator('.profile-photo > img').getAttribute('src'), avatar)
      await page.getByRole('button', { name: 'This week', exact: true }).click()
      await page
        .locator('#movie-catalogue')
        .getByRole('button', { name: 'Smoke Film A', exact: true })
        .click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Add to favorites', exact: true }).click()
      await dialog.getByRole('button', { name: 'Remove from favorites', exact: true }).waitFor()
      await dialog.getByRole('button', { name: "I've watched it", exact: true }).click()
      await dialog.getByRole('radio', { name: '3.5/5', exact: true }).check()
      await dialog.getByLabel('Your review (optional)', { exact: true }).fill('My profile review')
      await dialog.getByRole('button', { name: 'Save review', exact: true }).click()
      await dialog.locator('.review').getByText('My profile review', { exact: true }).waitFor()
      await dialog.getByRole('button', { name: 'Close ×', exact: true }).click()
      await f.profile(page)
      await page
        .locator('[aria-labelledby="profile-reviews"]')
        .getByText('My profile review', { exact: true })
        .waitFor()
      assert.equal(
        await page
          .locator('[aria-labelledby="profile-reviews"]')
          .getByText('Someone else review', { exact: true })
          .count(),
        0,
      )
      await page.locator('[aria-labelledby="profile-favorites"] .movie-card').waitFor()
      await page.locator('.profile-details form button:enabled').waitFor()
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: '/tmp/mainflix-profile-desktop.png', fullPage: true })
      await page.setViewportSize({ width: 320, height: 568 })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await page.screenshot({ path: '/tmp/mainflix-profile-mobile.png', fullPage: true })
      await page.getByRole('button', { name: 'Remove from favorites', exact: true }).click()
      await page.getByText('You have no favorite movies yet.', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Remove photo', exact: true }).click()
      await page.locator('.profile-photo > img[src="/art/creeper-avatar.png"]').waitFor()
      await page.getByLabel('Current password', { exact: true }).fill('Browser test password!')
      await page
        .getByLabel('New password (6–128 characters)', { exact: true })
        .fill('Changed test password!')
      await page
        .locator('.password-settings')
        .getByRole('button', { name: 'Save', exact: true })
        .click()
      await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
      await page.getByLabel('Username or email', { exact: true }).fill('luna')
      await page.getByLabel('Password', { exact: true }).fill('Changed test password!')
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await page.getByRole('button', { name: 'Mainflix', exact: true }).click()
      await f.profile(page)
      await page.getByText('You have no favorite movies yet.', { exact: true }).waitFor()
      assert.equal(
        await page.locator('.profile-photo > img').getAttribute('src'),
        '/art/creeper-avatar.png',
      )
      const account = await f.database.client
        .selectFrom('users')
        .select('id')
        .where('username', '=', 'luna')
        .executeTakeFirstOrThrow()
      await f.container.userService.update(account.id, { name: 'Friend1', username: 'friend1' })
      await f.container.userService.changePassword(
        account.id,
        'Changed test password!',
        'Browser test password!',
      )
    } finally {
      await f.close()
    }
  },
)

test(
  'random nominations keep filters, reroll, cancel without saving, and accept the displayed TMDB film',
  { timeout: 60_000 },
  async () => {
    const f = new BrowserFixture()
    try {
      await f.prepare()
      const page = await f.page(true)
      const nominations: unknown[] = []
      const filters: string[] = []
      let mode: 'movies' | 'empty' | 'error' | 'slow' = 'movies'
      await page.route('**/api/movies/browse?**', async (route) => {
        const url = new URL(route.request().url())
        if (!url.searchParams.has('yearFrom')) return route.continue()
        filters.push(
          `${url.searchParams.get('category')}:${url.searchParams.get('yearFrom')}:${url.searchParams.get('yearTo')}`,
        )
        if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 300))
        await route
          .fulfill({
            json: {
              local: [],
              remote:
                mode === 'empty' || mode === 'error'
                  ? []
                  : [1, 2].map((id) => ({
                      tmdb_id: 1000 + id,
                      title: `Random film ${id}`,
                      release_year: 2014,
                      overview: 'Movie synopsis',
                      poster_path: null,
                    })),
              remoteError: mode === 'error' ? 'TMDB_UNAVAILABLE' : null,
              page: 1,
              totalPages: 1,
            },
          })
          .catch(() => {})
      })
      await page.route('**/api/rounds/*/response?**', async (route) => {
        nominations.push(route.request().postDataJSON())
        const round = await (
          await page.request.get(`${f.container.config.origin}/api/rounds/current`)
        ).json()
        await route.fulfill({ json: round })
      })
      await f.login(page, 'friend1@example.com')
      const picker = page.getByRole('region', { name: 'Random movie', exact: true })
      await picker.getByRole('button', { name: 'Random movie', exact: true }).click()
      const lightbox = page.getByRole('dialog', { name: 'Random movie', exact: true })
      await lightbox.waitFor()
      assert.equal(await lightbox.evaluate((element) => element.matches(':modal')), true)
      await page.keyboard.press('Escape')
      await lightbox.waitFor({ state: 'hidden' })
      assert.equal(
        await picker
          .getByRole('button', { name: 'Random movie', exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      )
      await picker.getByRole('button', { name: 'Random movie', exact: true }).click()
      await page.mouse.click(2, 2)
      await lightbox.waitFor({ state: 'hidden' })
      await picker.getByRole('button', { name: 'Random movie', exact: true }).click()
      await picker.getByLabel('Category', { exact: true }).selectOption('scienceFiction')
      await picker.getByLabel('From year', { exact: true }).fill('2014')
      await picker.getByRole('button', { name: 'Choose a movie', exact: true }).click()
      await picker.getByRole('button', { name: 'Accept and nominate', exact: true }).waitFor()
      const first = await picker.locator('.random-result h3').textContent()
      assert.deepEqual(nominations, [])
      await picker.getByRole('button', { name: 'Try again', exact: true }).click()
      await page.waitForFunction(
        (previous) => document.querySelector('.random-result h3')?.textContent !== previous,
        first,
      )
      assert.ok(filters.every((filter) => filter === 'scienceFiction:2014:2014'))
      await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.deepEqual(nominations, [])
      assert.equal(await picker.locator('.random-result').count(), 0)
      await picker.getByRole('button', { name: 'Random movie', exact: true }).click()
      await picker.getByLabel('To year', { exact: true }).fill('2020')
      mode = 'empty'
      await picker.getByRole('button', { name: 'Choose a movie', exact: true }).click()
      await picker.getByRole('alert').filter({ hasText: 'No movies found' }).waitFor()
      mode = 'error'
      await picker.getByRole('button', { name: 'Choose a movie', exact: true }).click()
      await picker
        .getByRole('alert')
        .filter({ hasText: 'TMDB is temporarily unavailable' })
        .waitFor()
      mode = 'slow'
      await picker.getByRole('button', { name: 'Choose a movie', exact: true }).click()
      await picker.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.waitForTimeout(400)
      assert.equal(await picker.locator('.random-result').count(), 0)
      mode = 'movies'
      await picker.getByRole('button', { name: 'Random movie', exact: true }).click()
      await picker.getByRole('button', { name: 'Choose a movie', exact: true }).click()
      await picker.getByRole('button', { name: 'Accept and nominate', exact: true }).waitFor()
      const chosen = await picker.locator('.random-result h3').textContent()
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await page.screenshot({ path: '/tmp/mainflix-random-mobile.png', fullPage: true })
      await picker.getByRole('button', { name: 'Accept and nominate', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'Your nomination is saved' }).waitFor()
      assert.deepEqual(nominations, [{ tmdbId: chosen === 'Random film 1' ? 1001 : 1002 }])
      assert.ok(filters.includes('scienceFiction:2014:2020'))
      assert.equal(await picker.locator('.random-result').count(), 0)
    } finally {
      await f.close()
    }
  },
)

test(
  'discovery shows featured films, paginates genres, switches language and preserves local controls',
  { timeout: 60_000 },
  async () => {
    const f = new BrowserFixture()
    try {
      await f.prepare()
      const page = await f.page()
      const calls: string[] = []
      let failHorrorPage = true
      await page.route('**/api/movies/browse?**', async (route) => {
        const url = new URL(route.request().url())
        const category = url.searchParams.get('category')
        const pageNumber = Number(url.searchParams.get('page'))
        const language = url.searchParams.get('language')
        calls.push(`${category}:${pageNumber}:${language}`)
        const titles =
          category === 'featured'
            ? ['La bola negra', 'Ruega por nosotras']
            : [`${category} page ${pageNumber}`]
        const remote = titles.map((title, i) => ({
          tmdb_id: category === 'featured' ? [1422041, 1522071][i] : pageNumber,
          title,
          release_year: 2026,
          overview: '',
          poster_path: null,
        }))
        if (category === 'recentlyAdded') {
          await route.continue()
          return
        }
        if (category === 'horror' && pageNumber === 2 && failHorrorPage) {
          failHorrorPage = false
          await route.fulfill({
            json: {
              local: [],
              remote: [],
              remoteError: 'TMDB_UNAVAILABLE',
              page: 2,
              totalPages: 2,
            },
          })
          return
        }
        await route.fulfill({
          json: {
            local: [],
            remote,
            remoteError: null,
            page: pageNumber,
            totalPages: category === 'featured' ? 1 : 2,
          },
        })
      })
      await f.login(page, 'friend1@example.com')
      const popular = page.getByRole('region', { name: 'Popular in Spain', exact: true })
      await popular.getByRole('heading', { name: 'La bola negra', exact: true }).waitFor()
      await popular.getByRole('heading', { name: 'Ruega por nosotras', exact: true }).waitFor()
      assert.equal(await page.locator('#browse-featured').count(), 0)
      const horror = page.locator('section').filter({ has: page.locator('#browse-horror') })
      await horror.getByRole('heading', { name: 'horror page 1', exact: true }).waitFor()
      await horror.getByRole('button', { name: 'Load more', exact: true }).click()
      await horror.getByRole('button', { name: 'Try again', exact: true }).click()
      await horror
        .getByRole('heading', { name: 'horror page 2', exact: true })
        .waitFor({ timeout: 3000 })
      assert.equal(
        await horror.getByRole('heading', { name: 'horror page 1', exact: true }).count(),
        1,
      )
      assert.equal(await horror.getByRole('button', { name: 'Load more', exact: true }).count(), 0)
      const recent = page.getByRole('region', { name: 'Recently added', exact: true })
      await recent.getByRole('button', { name: 'Smoke Film A', exact: true }).waitFor()
      await recent.getByRole('button', { name: 'Nominate', exact: true }).first().waitFor()
      await page.getByLabel('Browse by genre', { exact: true }).selectOption('scienceFiction')
      await page.getByRole('heading', { name: 'scienceFiction page 1', exact: true }).waitFor()
      await Promise.all([
        page.waitForResponse((r) => r.url().includes('category=featured&language=es')),
        page.getByLabel('Language / Idioma').selectOption('es'),
      ])
      await page.getByRole('heading', { name: 'Comedia romántica', exact: true }).waitFor()
      assert.ok(calls.includes('featured:1:es'))
      assert.ok(calls.includes('horror:2:en'))
      for (const width of [375, 320, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        )
      }
      await page.locator('.profile-menu > summary').click()
      await page.getByRole('button', { name: 'Salir', exact: true }).click()
      await page.getByRole('button', { name: 'Entrar', exact: true }).waitFor()
      assert.equal(await page.getByText('La bola negra', { exact: true }).count(), 0)
    } finally {
      await f.close()
    }
  },
)

test(
  'initial catalogue, expired admin session isolation, weighted shared draw, reviews, and Spanish UI',
  { timeout: 120_000 },
  async () => {
    const f = new BrowserFixture()
    try {
      await f.prepare()
      const pages: Page[] = await Promise.all([1, 2, 3, 4].map(() => f.page()))
      const admin: Page = await f.page()
      await f.login(admin, 'admin@example.com')
      // Regression: approved films appear immediately, without typing or changing tabs.
      await admin
        .locator('#movie-catalogue')
        .getByRole('button', { name: 'Smoke Film A', exact: true })
        .waitFor({ timeout: 5000 })
      await admin.getByRole('button', { name: 'Admin', exact: true }).click()
      await admin.getByText('friend4@example.com', { exact: true }).waitFor()
      await f.database.client.deleteFrom('sessions').where('user_id', '=', 1).execute()
      await admin.getByRole('button', { name: 'Sign in', exact: true }).waitFor({ timeout: 10000 })
      await f.login(admin, 'friend2@example.com')
      // Regression: a different account never inherits the admin's cached panel or dialog.
      assert.equal(await admin.getByRole('button', { name: 'Admin', exact: true }).count(), 0)
      assert.equal(await admin.getByText('friend4@example.com', { exact: true }).count(), 0)
      await admin
        .locator('#movie-catalogue')
        .getByRole('button', { name: 'Smoke Film A', exact: true })
        .waitFor()
      await admin.locator('.profile-menu > summary').click()
      await admin.getByRole('button', { name: 'Sign out', exact: true }).click()
      await f.login(admin, 'admin@example.com')
      for (let i = 0; i < 4; i++) await f.login(pages[i]!, `friend${i + 1}@example.com`)
      for (const [i, page] of pages.entries()) {
        const card = page.locator('#movie-catalogue article').filter({
          has: page.getByRole('button', {
            name: i < 2 ? 'Smoke Film A' : 'Smoke Film B',
            exact: true,
          }),
        })
        await card.getByRole('button', { name: 'Nominate', exact: true }).click()
      }
      await admin
        .getByRole('button', { name: "Draw this week's movie", exact: true })
        .waitFor({ timeout: 10000 })
      await admin.getByRole('button', { name: "Draw this week's movie", exact: true }).click()
      const wheel = admin.locator('.roulette-wheel')
      await wheel.waitFor()
      assert.deepEqual(await wheel.locator('title').allTextContents(), [
        'Smoke Film A',
        'Smoke Film A',
        'Smoke Film B',
        'Smoke Film B',
        'Smoke Film A',
        'Smoke Film A',
        'Smoke Film B',
        'Smoke Film B',
      ])
      const start = await wheel.evaluate((element) => getComputedStyle(element).transform)
      await admin.waitForTimeout(200)
      assert.notEqual(await wheel.evaluate((element) => getComputedStyle(element).transform), start)
      await admin.waitForFunction(() => {
        const bounds = document.querySelector('.roulette-wheel')?.getBoundingClientRect()
        return bounds && bounds.top >= 0 && bounds.bottom <= innerHeight
      })
      await wheel.evaluate((element) =>
        element.getAnimations().forEach((animation) => animation.finish()),
      )
      const saved = await (
        await admin.request.get(`${f.container.config.origin}/api/rounds/current`)
      ).json()
      const names = await wheel.locator('title').allTextContents()
      const midpoint = ((names.indexOf(saved.winner.title) + 0.5) * 360) / names.length
      const rotation = await wheel.evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
        return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI
      })
      const pointerAngle = (((rotation + midpoint) % 360) + 360) % 360
      assert.ok(
        Math.min(pointerAngle, 360 - pointerAngle) < 0.01,
        'The pointer must land on the server winner',
      )
      await admin.screenshot({ path: '/tmp/mainflix-roulette-desktop.png', fullPage: true })
      await admin.setViewportSize({ width: 375, height: 667 })
      assert.equal(
        await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await admin.screenshot({ path: '/tmp/mainflix-roulette-mobile.png', fullPage: true })
      await admin.setViewportSize({ width: 1280, height: 900 })
      const winners: string[] = []
      for (const page of pages) {
        const winner = page.locator('.winner .text-button')
        await winner.waitFor({ timeout: 10000 })
        winners.push((await winner.textContent())!)
      }
      assert.equal(new Set(winners).size, 1)
      for (const [index, page] of pages.entries()) {
        const survey = page.locator('.survey-dialog')
        await survey.waitFor({ timeout: 10000 })
        if (index === 0) {
          assert.equal(await survey.getByRole('button', { name: 'Next', exact: true }).count(), 0)
          await survey.getByRole('checkbox', { name: 'friend1', exact: true }).check()
          await survey.getByRole('checkbox', { name: 'friend2', exact: true }).check()
          await survey.getByRole('button', { name: 'Send', exact: true }).click()
          await survey.getByRole('button', { name: 'Next', exact: true }).waitFor()
          assert.equal(await survey.locator('h3').textContent(), 'Smoke Film A')
          assert.equal(await survey.getByText('100%', { exact: true }).count(), 2)
          await survey.screenshot({ path: '/tmp/mainflix-survey-desktop.png' })
          for (const width of [375, 320]) {
            await page.setViewportSize({ width, height: 667 })
            assert.equal(
              await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
              false,
            )
            assert.equal(
              await survey.evaluate((element) => element.scrollWidth > element.clientWidth),
              false,
            )
            await survey.screenshot({ path: `/tmp/mainflix-survey-${width}.png` })
          }
          await page.setViewportSize({ width: 1280, height: 900 })
          await survey.getByRole('button', { name: 'Next', exact: true }).click()
          await survey.getByRole('heading', { name: 'Smoke Film B', exact: true }).waitFor()
          await survey.getByRole('button', { name: 'Skip question', exact: true }).click()
          await survey.getByRole('button', { name: 'Finish', exact: true }).click()
          await survey
            .getByText('Your survey is complete. Waiting for everyone else to finish or skip.', {
              exact: true,
            })
            .waitFor()
        } else {
          await survey.getByRole('button', { name: 'Skip survey', exact: true }).click()
          await survey
            .getByRole('button', { name: 'Skip survey', exact: true })
            .waitFor({ state: 'hidden' })
        }
        await survey.getByRole('button', { name: 'Close ×', exact: true }).click()
      }
      await admin
        .getByRole('heading', { name: 'Who nominated what', exact: true })
        .waitFor({ timeout: 10000 })
      const revealed = await (
        await admin.request.get(`${f.container.config.origin}/api/rounds/current`)
      ).json()
      assert.equal(revealed.revealed, true)
      assert.deepEqual(
        revealed.responses.map((response: { title: string }) => response.title),
        ['Smoke Film A', 'Smoke Film A', 'Smoke Film B', 'Smoke Film B'],
      )
      await pages[0]!.getByRole('button', { name: 'Survey results', exact: true }).click()
      const reopenedSurvey = pages[0]!.locator('.survey-dialog')
      await reopenedSurvey.getByRole('heading', { name: 'Smoke Film A', exact: true }).waitFor()
      await reopenedSurvey.getByRole('heading', { name: 'Smoke Film B', exact: true }).waitFor()
      assert.equal(
        await reopenedSurvey.getByRole('button', { name: 'Next', exact: true }).count(),
        0,
      )
      assert.equal(await reopenedSurvey.getByRole('checkbox').count(), 0)
      assert.equal(
        await reopenedSurvey.getByText('Nominated this movie', { exact: true }).count(),
        4,
      )
      await reopenedSurvey.getByRole('button', { name: 'Close ×', exact: true }).click()
      await pages[0]!.getByRole('button', { name: 'About Mainflix', exact: true }).click()
      await pages[0]!.getByRole('heading', { name: 'About Mainflix', exact: true }).waitFor()
      await pages[0]!.locator('main').screenshot({ path: '/tmp/mainflix-about-desktop.png' })
      await pages[0]!.setViewportSize({ width: 320, height: 568 })
      assert.equal(
        await pages[0]!.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await pages[0]!.screenshot({ path: '/tmp/mainflix-about-mobile.png', fullPage: true })
      await pages[0]!.setViewportSize({ width: 1280, height: 900 })
      await pages[0]!.getByRole('button', { name: 'This week', exact: true }).click()
      await admin.getByRole('button', { name: 'Replay roulette', exact: true }).click()
      await wheel.waitFor()
      await admin.locator('.winner .text-button').waitFor()
      const replayed = await (
        await admin.request.get(`${f.container.config.origin}/api/rounds/current`)
      ).json()
      assert.equal(replayed.winner.id, saved.winner.id)
      assert.equal(replayed.drawn_at, saved.drawn_at)
      await admin.emulateMedia({ reducedMotion: 'reduce' })
      await admin.getByRole('button', { name: 'Replay roulette', exact: true }).click()
      await admin.locator('.winner .text-button').waitFor({ timeout: 1000 })
      await admin.emulateMedia({ reducedMotion: 'no-preference' })
      await admin.locator('.winner .text-button').click()
      await admin.getByRole('button', { name: "I've watched it", exact: true }).click()
      const picker = admin.locator('.diamond-picker')
      await picker.waitFor()
      assert.equal(await picker.locator('input[type="radio"]').count(), 10)
      assert.equal(await picker.locator('input:checked').count(), 0)
      await picker.getByRole('radio', { name: '0.5/5', exact: true }).check()
      await picker.locator('label').nth(6).hover()
      assert.equal(
        await picker.getByRole('radio', { name: '0.5/5', exact: true }).isChecked(),
        true,
      )
      assert.equal(
        await picker
          .locator('.diamond-half')
          .nth(6)
          .evaluate((el) => getComputedStyle(el).opacity),
        '1',
      )
      assert.equal(
        await picker
          .locator('.diamond-half')
          .nth(7)
          .evaluate((el) => getComputedStyle(el).opacity),
        '0.35',
      )
      await admin.getByLabel('Your review (optional)', { exact: true }).hover()
      assert.equal(
        await picker
          .locator('.diamond-half')
          .nth(1)
          .evaluate((el) => getComputedStyle(el).opacity),
        '0.35',
      )
      await picker.getByRole('radio', { name: '5/5', exact: true }).check()
      await picker.getByRole('radio', { name: '5/5', exact: true }).press('ArrowLeft')
      assert.equal(
        await picker.getByRole('radio', { name: '4.5/5', exact: true }).isChecked(),
        true,
      )
      await admin.getByLabel('Your review (optional)', { exact: true }).fill('A great movie night.')
      await admin.getByRole('button', { name: 'Save review', exact: true }).click()
      await admin.locator('.review').getByText('A great movie night.', { exact: true }).waitFor()
      assert.equal(await admin.locator('.review [aria-label="4.5/5"] .rating-diamond').count(), 5)
      assert.equal(
        await admin
          .locator('.review .rating-diamond img')
          .last()
          .evaluate((el) => getComputedStyle(el).clipPath),
        'inset(0px 50% 0px 0px)',
      )
      await admin.screenshot({ path: '/tmp/mainflix-selected-review-desktop.png', fullPage: true })
      await admin.setViewportSize({ width: 375, height: 667 })
      assert.equal(
        await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await admin.screenshot({ path: '/tmp/mainflix-selected-review-mobile.png', fullPage: true })
      await admin.setViewportSize({ width: 1280, height: 900 })
      await admin.reload()
      await admin.getByRole('button', { name: 'Mainflix', exact: true }).click()
      await admin.locator('.winner .text-button').click()
      await admin.locator('.review').getByText('A great movie night.', { exact: true }).waitFor()
      assert.equal(await admin.getByRole('radio', { name: '4.5/5', exact: true }).isChecked(), true)
      await pages[0]!.locator('.winner .text-button').click()
      await pages[0]!
        .getByText('Review this movie to see your friends’ reviews.', { exact: true })
        .waitFor()
      assert.equal(await pages[0]!.locator('.review').count(), 0)
      await pages[0]!.getByRole('button', { name: "I've watched it", exact: true }).click()
      assert.equal(await pages[0]!.locator('.review').count(), 0)
      await pages[0]!.getByRole('radio', { name: '3.5/5', exact: true }).check()
      await pages[0]!
        .getByLabel('Your review (optional)', { exact: true })
        .fill('Friend1 shared review.')
      await pages[0]!.getByRole('button', { name: 'Save review', exact: true }).click()
      await pages[0]!
        .locator('.review')
        .getByText('A great movie night.', { exact: true })
        .waitFor()
      await pages[0]!
        .locator('.review')
        .getByText('Friend1 shared review.', { exact: true })
        .waitFor()
      await admin.getByRole('button', { name: 'Close ×', exact: true }).click()
      await admin.getByRole('button', { name: 'Reviews', exact: true }).click()
      await admin
        .locator('.reviewed-movie')
        .getByText('Friend1 shared review.', { exact: true })
        .waitFor()
      assert.equal(await admin.locator('.reviewed-movie').count(), 1)
      assert.equal(await admin.locator('.reviewed-movie .review').count(), 2)
      await admin.getByRole('button', { name: 'Rate movie', exact: true }).click()
      await admin.getByRole('radio', { name: '5/5', exact: true }).check()
      await admin.getByRole('button', { name: 'Save review', exact: true }).click()
      await admin.getByRole('dialog').getByRole('img', { name: '5/5', exact: true }).waitFor()
      await admin.getByRole('button', { name: 'Close ×', exact: true }).click()
      await admin
        .locator('.reviewed-movie')
        .getByRole('img', { name: '5/5', exact: true })
        .waitFor()
      await admin.locator('main').screenshot({ path: '/tmp/mainflix-reviews-desktop.png' })
      await admin.setViewportSize({ width: 320, height: 568 })
      assert.equal(
        await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await admin.screenshot({ path: '/tmp/mainflix-reviews-mobile.png', fullPage: true })
      await admin.setViewportSize({ width: 1280, height: 900 })
      await admin.getByLabel('Language / Idioma').selectOption('es')
      await admin.getByRole('heading', { name: 'Reseñas', exact: true }).waitFor()
      await admin.getByRole('button', { name: 'Historial', exact: true }).click()
      await admin.getByRole('heading', { name: 'Historial', exact: true }).waitFor()
      await admin.screenshot({ path: '/tmp/mainflix-desktop.png', fullPage: true })
      await admin.setViewportSize({ width: 375, height: 667 })
      await admin.screenshot({ path: '/tmp/mainflix-iphone-se.png', fullPage: true })
      assert.equal(
        await admin.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
    } finally {
      await f.close()
    }
  },
)

test(
  'iPhone SE supports login, cards, nomination, review dialog and both languages without horizontal overflow',
  { timeout: 60_000 },
  async () => {
    const f = new BrowserFixture()
    try {
      await f.prepare()
      const page: Page = await f.page(true)
      assert.equal(page.viewportSize()?.width, 375)
      assert.equal(page.viewportSize()?.height, 667)
      await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor()
      for (const [width, height] of [
        [375, 667],
        [320, 568],
        [667, 375],
        [568, 320],
        [768, 1024],
        [1440, 900],
      ] as const) {
        await page.setViewportSize({ width, height })
        const submit = await page
          .getByRole('button', { name: 'Sign in', exact: true })
          .boundingBox()
        assert.ok(submit)
        const artBounds = await page.locator('.auth-layout .hero').boundingBox()
        const formBounds = await page.locator('.auth-panel').boundingBox()
        assert.ok(artBounds && formBounds)
        assert.ok(
          formBounds.y >= artBounds.y + artBounds.height - 1 ||
            formBounds.x >= artBounds.x + artBounds.width - 1,
          `Artwork and sign-in form must not overlap at ${width}×${height}`,
        )
        if (height > width && width <= 375) {
          assert.ok(
            submit.y + submit.height <= height,
            `Sign in must fit the first screen at ${width}×${height}`,
          )
          const art = await page.locator('.auth-layout .hero').boundingBox()
          const form = await page.locator('.auth-panel').boundingBox()
          assert.ok(
            art && form && form.y >= art.y + art.height - 1,
            'Form must remain below character artwork',
          )
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        )
        await page.screenshot({ path: `/tmp/mainflix-auth-${width}x${height}.png`, fullPage: true })
      }
      await page.setViewportSize({ width: 375, height: 667 })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await page.screenshot({ path: '/tmp/mainflix-iphone-se-login.png', fullPage: true })
      await f.login(page, 'friend1@example.com')
      await page
        .locator('#movie-catalogue')
        .getByRole('button', { name: 'Smoke Film A', exact: true })
        .waitFor()
      await page.getByRole('searchbox').fill('Smoke Film B')
      await page
        .locator('#movie-catalogue')
        .getByRole('button', { name: 'Smoke Film A', exact: true })
        .waitFor({ state: 'hidden' })
      await page
        .locator('#movie-catalogue')
        .getByRole('button', { name: 'Smoke Film B', exact: true })
        .waitFor()
      await page.getByRole('searchbox').fill('')
      await page
        .locator('#movie-catalogue')
        .getByRole('button', { name: 'Smoke Film A', exact: true })
        .waitFor()
      await page.screenshot({ path: '/tmp/mainflix-iphone-se-week.png', fullPage: true })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await page
        .locator('#movie-catalogue')
        .getByRole('button', { name: 'Smoke Film A', exact: true })
        .click()
      await page.getByRole('dialog').waitFor()
      await page.getByRole('button', { name: "I've watched it", exact: true }).click()
      await page.getByRole('radio', { name: '0.5/5', exact: true }).check()
      await page.getByLabel('Your review (optional)', { exact: true }).fill('An iPhone SE review.')
      await page.getByRole('button', { name: 'Save review', exact: true }).click()
      await page.locator('.review').getByText('An iPhone SE review.', { exact: true }).waitFor()
      assert.equal(
        await page
          .getByRole('dialog')
          .evaluate((element) => element.scrollWidth > element.clientWidth),
        false,
      )
      await page.screenshot({ path: '/tmp/mainflix-iphone-se-review.png', fullPage: true })
      await page.getByRole('button', { name: 'Close ×', exact: true }).click()
      const card = page
        .locator('#movie-catalogue article')
        .filter({ has: page.getByRole('button', { name: 'Smoke Film A', exact: true }) })
      await card.getByRole('button', { name: 'Nominate', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'Your nomination is saved' }).waitFor()
      await Promise.all([
        page.waitForRequest((request) => {
          const url = new URL(request.url())
          return url.pathname === '/api/movies' && url.searchParams.get('language') === 'es'
        }),
        page.getByLabel('Language / Idioma').selectOption('es'),
      ])
      await page.getByRole('button', { name: 'Catálogo', exact: true }).click()
      await page.getByRole('heading', { name: 'Buscar películas', exact: true }).waitFor()
      await page.screenshot({ path: '/tmp/mainflix-iphone-se-catalogue.png', fullPage: true })
      await page.setViewportSize({ width: 320, height: 568 })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await page.screenshot({ path: '/tmp/mainflix-320.png', fullPage: true })
      for (const [width, height] of [
        [568, 320],
        [667, 375],
        [768, 1024],
        [1440, 900],
      ] as const) {
        await page.setViewportSize({ width, height })
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `Catalogue overflow at ${width}×${height}`,
        )
        await page.getByRole('button', { name: 'Esta semana', exact: true }).click()
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `Weekly page overflow at ${width}×${height}`,
        )
        await page.screenshot({ path: `/tmp/mainflix-week-${width}x${height}.png`, fullPage: true })
        await page.getByRole('button', { name: 'Catálogo', exact: true }).click()
      }
    } finally {
      await f.close()
    }
  },
)

test(
  'named groups and both invitation types work on desktop and mobile',
  { timeout: 120_000 },
  async () => {
    const f = new BrowserFixture()
    try {
      await f.prepare()
      const owner = await f.page()
      await owner.getByLabel('Username or email', { exact: true }).fill('friend1')
      await owner.getByLabel('Password', { exact: true }).fill('Wrong password!')
      await owner.getByRole('button', { name: 'Sign in', exact: true }).click()
      const toast = owner.locator('.error-toast')
      await toast.waitFor()
      assert.equal(await toast.evaluate((element) => getComputedStyle(element).position), 'fixed')
      await toast.waitFor({ state: 'hidden', timeout: 6500 })
      await f.login(owner, 'friend1')
      await owner
        .locator('.group-toolbar')
        .getByRole('button', { name: 'Switch group', exact: true })
        .click()
      await owner.getByRole('button', { name: 'Create new group', exact: true }).click()
      await owner.getByLabel('Group name', { exact: true }).fill('🍿 Family')
      await owner.getByRole('button', { name: 'Create group', exact: true }).click()
      await owner.locator('.group-toolbar strong').getByText('🍿 Family', { exact: true }).waitFor()
      await owner.locator('.profile-menu > summary').click()
      await owner.getByRole('button', { name: 'Invite to Mainflix', exact: true }).click()
      const appLink = await owner
        .getByLabel('Private invitation link', { exact: true })
        .inputValue()
      const guest = await f.page(true)
      await guest.goto(appLink)
      await guest.getByLabel('Username', { exact: true }).fill('invited_friend')
      await guest.getByLabel('Password', { exact: true }).fill('New friend password!')
      await guest.getByRole('button', { name: 'Create account', exact: true }).click()
      await guest
        .getByText('Create your first group to start your movie nights.', { exact: true })
        .waitFor()
      assert.equal(await guest.getByRole('button', { name: '🍿 Family', exact: true }).count(), 0)
      await f.profile(guest)
      await guest.getByRole('heading', { name: 'My profile', exact: true }).waitFor()
      await guest.locator('.profile-menu > summary').click()
      await guest.getByRole('button', { name: 'Switch group', exact: true }).click()
      await guest.getByRole('button', { name: 'Create new group', exact: true }).click()
      await guest.getByLabel('Group name', { exact: true }).fill('Friends')
      await guest.getByRole('button', { name: 'Create group', exact: true }).click()
      await guest.locator('.group-toolbar strong').getByText('Friends', { exact: true }).waitFor()
      await owner.getByRole('button', { name: 'Invite to this group', exact: true }).click()
      const groupLink = await owner
        .getByLabel('Private invitation link', { exact: true })
        .inputValue()
      assert.notEqual(groupLink, appLink)
      await guest.goto(groupLink)
      await guest
        .getByRole('heading', { name: "You're invited to 🍿 Family", exact: true })
        .waitFor()
      await guest.getByRole('button', { name: 'Accept invitation', exact: true }).click()
      await guest.getByRole('button', { name: '🍿 Family', exact: true }).waitFor()
      await guest.screenshot({ path: '/tmp/mainflix-groups-mobile.png', fullPage: true })
      await guest.getByRole('button', { name: '🍿 Family', exact: true }).click()
      await guest.locator('.group-toolbar strong').getByText('🍿 Family', { exact: true }).waitFor()
      assert.equal(
        await guest.getByRole('button', { name: 'Invite to this group', exact: true }).count(),
        0,
      )
      assert.equal(
        await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await owner.getByText('Submit a missing movie', { exact: true }).click()
      await owner.getByLabel('Movie title', { exact: true }).fill('Family only film')
      await owner.getByRole('button', { name: 'Add movie', exact: true }).click()
      await owner
        .locator('#movie-catalogue')
        .getByRole('button', { name: 'Family only film', exact: true })
        .waitFor()
      await guest
        .locator('.group-toolbar')
        .getByRole('button', { name: 'Switch group', exact: true })
        .click()
      await guest.getByRole('button', { name: 'Friends', exact: true }).click()
      await guest.locator('.group-toolbar strong').getByText('Friends', { exact: true }).waitFor()
      assert.equal(
        await guest.getByRole('button', { name: 'Family only film', exact: true }).count(),
        0,
      )
      await owner.screenshot({ path: '/tmp/mainflix-family-desktop.png', fullPage: true })
      await owner.getByRole('button', { name: 'Invite to this group', exact: true }).click()
      const existingLink = await owner
        .getByLabel('Private invitation link', { exact: true })
        .inputValue()
      assert.notEqual(existingLink, groupLink)
      const existing = await f.page(true)
      await existing.goto(existingLink)
      await existing.getByRole('button', { name: 'I already have an account', exact: true }).click()
      await existing.getByLabel('Username or email', { exact: true }).fill('friend2')
      await existing.getByLabel('Password', { exact: true }).fill('Browser test password!')
      assert.equal(
        await existing.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await existing.screenshot({
        path: '/tmp/mainflix-invitation-login-mobile.png',
        fullPage: true,
      })
      await existing.getByRole('button', { name: 'Sign in', exact: true }).click()
      await existing.getByRole('button', { name: 'Accept invitation', exact: true }).click()
      await existing.getByRole('button', { name: '🍿 Family', exact: true }).waitFor()
    } finally {
      await f.close()
    }
  },
)
