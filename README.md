# WeatherBlock Roofing website

The public site, booking, owner app and assistant for WeatherBlock Roofing, Ocean Isle Beach, NC.

Built with Astro and TypeScript, hosted on Netlify. Pages are plain HTML; small Preact pieces handle anything you tap.

## The facts file

Everything the site and the assistant say about the business comes from [`facts.yaml`](facts.yaml): the name, phone, service area, what the inspection costs, licenses, insurance, warranty, reviews, financing.

- Leave a value blank and everything that depends on it stays hidden, everywhere.
- The business name is set once there. Renaming is a one-line change.
- Help center answers live in [`src/content/help/`](src/content/help/), one Markdown file per question. They can use facts as `{{contact.phone}}`, and a paragraph that mentions a blank fact is left out. See the top of [`src/facts/template.ts`](src/facts/template.ts) for the syntax.

## Run it

Needs Node 22.23 or newer.

```sh
npm install
npm run dev          # http://localhost:4321
```

## Test

```sh
npm test                                   # unit tests: facts, help center, house rules
npm run build:node && npm run test:e2e     # Playwright at 320px and 390px, light and dark, with axe accessibility checks
FORCE_INDEXABLE=1 npm run build:node && npm run lhci   # Lighthouse, phone settings, 95+ required
```

Lighthouse needs Chrome. If it isn't found, set `CHROME_PATH` to a Chrome or Chromium binary.

All of these run on every pull request in GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Deploy

Netlify builds every pull request as a deploy preview and deploys `main` to production.

- Build command `npm run build`, publish directory `dist` (both set in [`netlify.toml`](netlify.toml)).
- Environment variables: see [`.env.example`](.env.example). Keys go in Netlify's environment settings, never in the repo.
- Until `web.launched` is `true` in `facts.yaml`, every page tells search engines to stay out.

## Where things are

| Path | What |
| --- | --- |
| `facts.yaml` | Every fact the site may state |
| `src/content/help/` | Help center answers |
| `src/pages/` | Pages (one file per URL) |
| `src/components/`, `src/layouts/` | Shared pieces |
| `src/styles/global.css` | Colors from the logo, type, buttons, forms |
| `tests/unit/`, `tests/e2e/` | Tests |

See [`STATUS.md`](STATUS.md) for what's done and what's next.
