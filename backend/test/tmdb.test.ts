import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Tmdb } from '../src/services/tmdb.js'

const movie = { id: 1, title: 'A movie', release_date: '2026-11-06', poster_path: null }

test('Christmas browsing uses the Christmas keyword with Spanish releases and pagination', async () => {
  const tmdb = new Tmdb('test', async (input) => {
    const url = new URL(String(input))
    assert.equal(url.pathname, '/3/discover/movie')
    assert.equal(url.searchParams.get('with_keywords'), '207317')
    assert.equal(url.searchParams.get('region'), 'ES')
    assert.equal(url.searchParams.get('language'), 'es-ES')
    assert.equal(url.searchParams.get('page'), '2')
    return Response.json({ results: [movie], total_pages: 3 })
  })
  const result = await tmdb.browse('christmas', 'es', 2, new Date())
  assert.equal(result.movies[0]?.title, 'A movie')
  assert.equal(result.totalPages, 3)
})

test('watch providers return only Spanish subscriptions and rentals with platform logos', async () => {
  const netflix = { provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg' }
  const amazon = { provider_id: 10, provider_name: 'Amazon Video', logo_path: '/amazon.jpg' }
  const link = 'https://www.themoviedb.org/movie/1/watch?locale=ES'
  const tmdb = new Tmdb('test', async (input) => {
    assert.equal(new URL(String(input)).pathname, '/3/movie/1/watch/providers')
    return Response.json({
      id: 1,
      results: {
        ES: { link, flatrate: [netflix], rent: [amazon], buy: [amazon] },
        US: { link: 'https://www.themoviedb.org/movie/1/watch?locale=US', flatrate: [amazon] },
      },
    })
  })
  assert.deepEqual(await tmdb.watchProviders(1), { link, flatrate: [netflix], rent: [amazon] })
})

test('missing Spanish availability does not fall back to another country', async () => {
  const tmdb = new Tmdb('test', async () => Response.json({ id: 1, results: { US: {} } }))
  assert.equal(await tmdb.watchProviders(1), null)
  const rentals = new Tmdb('test', async () =>
    Response.json({
      results: { ES: { link: 'https://www.themoviedb.org/movie/1/watch?locale=ES' } },
    }),
  )
  assert.deepEqual(await rentals.watchProviders(1), {
    link: 'https://www.themoviedb.org/movie/1/watch?locale=ES',
    flatrate: [],
    rent: [],
  })
})

test('watch providers reject unsafe logos, links, malformed payloads and upstream errors', async () => {
  for (const payload of [
    {},
    { results: { ES: { link: 'javascript:alert(1)' } } },
    {
      results: {
        ES: {
          link: 'https://www.themoviedb.org/movie/1/watch?locale=ES',
          flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '//other.test/logo' }],
        },
      },
    },
  ]) {
    const tmdb = new Tmdb('test', async () => Response.json(payload))
    await assert.rejects(tmdb.watchProviders(1), { code: 'TMDB_UNAVAILABLE' })
  }
  await assert.rejects(
    new Tmdb('test', async () => new Response('', { status: 503 })).watchProviders(1),
    {
      code: 'TMDB_UNAVAILABLE',
    },
  )
})

test('year filters use an inclusive primary release year range', async () => {
  for (const [from, to] of [
    [2014, 2014],
    [1990, 2000],
  ] as const) {
    const tmdb = new Tmdb('test', async (input) => {
      const url = new URL(String(input))
      assert.equal(url.searchParams.get('primary_release_date.gte'), `${from}-01-01`)
      assert.equal(url.searchParams.get('primary_release_date.lte'), `${to}-12-31`)
      assert.equal(url.searchParams.get('with_genres'), '878')
      return Response.json({ results: [], total_pages: 0 })
    })
    assert.deepEqual(await tmdb.browse('scienceFiction', 'en', 1, new Date(), from, to), {
      movies: [],
      totalPages: 0,
    })
  }
})

test('Barbie browsing searches Barbie titles with paginated results', async () => {
  const tmdb = new Tmdb('test', async (input) => {
    const url = new URL(String(input))
    assert.equal(url.pathname, '/3/search/movie')
    assert.equal(url.searchParams.get('query'), 'Barbie')
    assert.equal(url.searchParams.get('include_adult'), 'false')
    assert.equal(url.searchParams.get('with_genres'), null)
    assert.equal(url.searchParams.get('page'), '2')
    return Response.json({ results: [{ ...movie, title: 'Barbie' }], total_pages: 2 })
  })
  assert.equal((await tmdb.browse('barbie', 'es', 2, new Date())).movies[0]?.title, 'Barbie')
})

test('discovery uses Spain releases, combined romcom genres and upstream pagination', async () => {
  const tmdb = new Tmdb('test', async (input) => {
    const url = new URL(String(input))
    assert.equal(url.pathname, '/3/discover/movie')
    assert.equal(url.searchParams.get('region'), 'ES')
    assert.equal(url.searchParams.get('language'), 'es-ES')
    assert.equal(url.searchParams.get('with_genres'), '35,10749')
    assert.equal(url.searchParams.get('sort_by'), 'popularity.desc')
    assert.equal(url.searchParams.get('page'), '2')
    assert.equal(url.searchParams.get('include_adult'), 'false')
    return Response.json({ results: [movie], total_pages: 3 })
  })
  const result = await tmdb.browse('romanticComedy', 'es', 2, new Date('2026-11-12T12:00Z'))
  assert.equal(result.movies[0]?.title, 'A movie')
  assert.equal(result.totalPages, 3)
})

test('new releases use recent Spanish release dates and exclude future releases', async () => {
  const tmdb = new Tmdb('test', async (input) => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get('release_date.gte'), '2026-08-14')
    assert.equal(url.searchParams.get('release_date.lte'), '2026-11-12')
    assert.equal(url.searchParams.get('with_release_type'), '3|2|4')
    return Response.json({ results: [], total_pages: 0 })
  })
  assert.deepEqual(await tmdb.browse('newReleases', 'en', 1, new Date('2026-11-12T12:00Z')), {
    movies: [],
    totalPages: 0,
  })
})

test('featured films use exact IDs rather than ambiguous title searches', async () => {
  const tmdb = new Tmdb('test', async (input) => {
    const id = Number(new URL(String(input)).pathname.split('/').pop())
    assert.ok([1422041, 1522071].includes(id))
    return Response.json({ ...movie, id })
  })
  const result = await tmdb.browse('featured', 'es', 1, new Date())
  assert.deepEqual(
    result.movies.map((m) => m.tmdb_id),
    [1422041, 1522071],
  )
  assert.equal(result.totalPages, 1)
})

test('discovery rejects malformed metadata and missing configuration', async () => {
  const tmdb = new Tmdb('test', async () =>
    Response.json({ results: [{ id: -1 }], total_pages: 1 }),
  )
  await assert.rejects(tmdb.browse('horror', 'es', 1, new Date()), { code: 'TMDB_UNAVAILABLE' })
  await assert.rejects(new Tmdb('').browse('popular', 'es', 1, new Date()), {
    code: 'TMDB_NOT_CONFIGURED',
  })
})
