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
        ['001_initial.sql', '002_usernames.sql', '003_optional_email.sql'].map((file) =>
          readFile(new URL(`../../db/${file}`, import.meta.url), 'utf8'),
        ),
      ),
    )
    await sql`TRUNCATE users,movies,rounds,rate_limits RESTART IDENTITY CASCADE`.execute(
      this.database.client,
    )
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
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor()
  }
  async close(): Promise<void> {
    await this.browser?.close()
    await this.container.close()
  }
}

test(
  'initial catalogue, expired admin session isolation, weighted shared draw, reviews, and Spanish UI',
  { timeout: 90_000 },
  async () => {
    const f = new BrowserFixture()
    try {
      await f.prepare()
      const pages: Page[] = await Promise.all([1, 2, 3, 4].map(() => f.page()))
      const admin: Page = await f.page()
      await f.login(admin, 'admin@example.com')
      // Regression: approved films appear immediately, without typing or changing tabs.
      await admin
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
      await admin.getByRole('button', { name: 'Smoke Film A', exact: true }).waitFor()
      await admin.getByRole('button', { name: 'Sign out', exact: true }).click()
      await f.login(admin, 'admin@example.com')
      for (let i = 0; i < 4; i++) await f.login(pages[i]!, `friend${i + 1}@example.com`)
      for (const [i, page] of pages.entries()) {
        const card = page.locator('article').filter({
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
      await admin.getByLabel('Your review (optional)', { exact: true }).fill('A great movie night.')
      await admin.getByRole('button', { name: 'Save review', exact: true }).click()
      await admin.locator('.review').getByText('A great movie night.', { exact: true }).waitFor()
      await admin.getByRole('button', { name: 'Close ×', exact: true }).click()
      await admin.getByLabel('Language / Idioma').selectOption('es')
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
      await page.getByRole('button', { name: 'Smoke Film A', exact: true }).waitFor()
      await page.getByRole('searchbox').fill('Smoke Film B')
      await page
        .getByRole('button', { name: 'Smoke Film A', exact: true })
        .waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: 'Smoke Film B', exact: true }).waitFor()
      await page.getByRole('searchbox').fill('')
      await page.getByRole('button', { name: 'Smoke Film A', exact: true }).waitFor()
      await page.screenshot({ path: '/tmp/mainflix-iphone-se-week.png', fullPage: true })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await page.getByRole('button', { name: 'Smoke Film A', exact: true }).click()
      await page.getByRole('dialog').waitFor()
      await page.getByRole('button', { name: "I've watched it", exact: true }).click()
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
        .locator('article')
        .filter({ has: page.getByRole('button', { name: 'Smoke Film A', exact: true }) })
      await card.getByRole('button', { name: 'Nominate', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'Your nomination is saved' }).waitFor()
      await page.getByLabel('Language / Idioma').selectOption('es')
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
