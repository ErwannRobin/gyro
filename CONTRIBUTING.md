# Contributing to GYROLL

Thanks for helping! GYROLL is a small project with a few firm rules.

## Rules

1. **One file, no runtime dependencies.** The game must keep running as a single `index.html`, with no libraries, CDNs, fonts, images or audio files. Dev tools (ESLint, Playwright) are fine.
2. **Edit `src/`, not `index.html`.** Run `npm run build` and commit both `src/` and the rebuilt `index.html`; CI checks that they match.
3. **Keep it fast on phones.** Aim for 60 fps on a mid-range phone. Avoid per-frame allocations, and draw repeated objects through the instanced batches (`Renderer.addInst`).
4. **Daily runs must stay fair.** Changing `TrackGenerator` or its random calls changes every daily track. Say so clearly in your pull request.
5. **Two languages.** Every visible text goes through `tr()`, with French and English strings in `I18N` (`src/js/01-core.js`).
6. **Mobile first.** Big touch targets, no hover-only UI, portrait first.

## Workflow

```sh
npm install
npx playwright install chromium   # first time only
npm run serve                     # play at http://127.0.0.1:4173/
npm run build && npm run ci       # before you push: check + lint + tests
```

For controls, audio, performance or sharing changes, please also test on a **real phone** over HTTPS, for example with a Vercel preview deployment. Say in the pull request which devices you used.

## Pull request checklist

- [ ] `npm run ci` passes
- [ ] `index.html` rebuilt and committed
- [ ] Texts added in French and English
- [ ] Tested on a phone (which one?) if controls, rendering or sharing changed
