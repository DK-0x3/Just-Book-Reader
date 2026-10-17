# Just Book Reader

A local EPUB file gallery for Obsidian, built with Vue 3 and TypeScript.

Lists EPUB files by filename and updates when files are created, modified, renamed or deleted. Includes manual refresh, loading, empty and error states. EPUB contents are not read at this stage; metadata, covers and reading are not implemented yet.

## Development

Requires Node.js 22.12+ (current checks use Node.js 24).

```sh
npm ci
npm test
npm run typecheck
npm run dev
```

The browser harness renders the same gallery component. Choose local EPUB files to populate it; files stay in memory and are never uploaded. Closing/reopening the view keeps the selection, while reloading the page clears it. Files with the same name replace each other in the harness. Russian and English are available.

```sh
npm run build
npm run build:dev
```

The plugin build produces `main.js`, `manifest.json` and `styles.css` in `dist/plugin`. Vue and Vue I18n are bundled; only the Obsidian module is provided by the host. Components use CSS Modules with `<style module lang="scss">` and `$style` bindings. Local class names are transformed during the build; shared styles and stable Obsidian integration classes remain global. Theme colors use the host's CSS variables. Third-party license notices are generated in `THIRD-PARTY-NOTICES.md` and included in the bundle.

Unit tests cover catalog events, scan races, errors, cleanup and the browser file adapter. Production mock and browser checks do not replace testing in actual Obsidian desktop, Android or iOS; those checks remain pending.
