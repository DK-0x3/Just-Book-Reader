import { expect, test, type Page } from '@playwright/test';
import { makeEpub } from '../fixtures/epub';

async function parse(page: Page, data: Buffer) {
  return page.evaluate(async base64 => {
    const modulePath = '/src/infrastructure/epub/metadata.ts';
    const { readEpubMetadata } = await import(/* @vite-ignore */ modulePath);
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    try {
      const result = await readEpubMetadata(bytes.buffer, new AbortController().signal);
      return { title: result.title, author: result.author, mime: result.cover?.type, size: result.cover?.size, error: undefined };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, data.toString('base64'));
}

test('shows EPUB2/3 title, authors and raster covers; a broken image uses the placeholder', async ({ page }) => {
  const errors: string[] = [];
  const remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5174/')) remote.push(request.url());
  });
  await page.goto('/');
  await page.getByLabel('Выбрать EPUB').setInputFiles([
    { name: 'filename.epub', mimeType: 'application/epub+zip', buffer: await makeEpub() },
    { name: 'legacy.epub', mimeType: 'application/epub+zip', buffer: await makeEpub({ legacy: true, title: 'Legacy title', authors: ['One author'] }) },
    { name: 'broken-image.epub', mimeType: 'application/epub+zip', buffer: await makeEpub({ title: 'Kept title', cover: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }) },
    { name: 'invalid.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('not a zip') },
  ]);
  const current = page.getByTestId('book-card').filter({ has: page.getByRole('heading', { name: 'Настоящее название', exact: true }) });
  await expect(current.getByTestId('book-author')).toHaveText('Первый автор, Второй автор');
  await expect(current.locator('img')).toHaveJSProperty('naturalWidth', 1);
  const legacy = page.getByTestId('book-card').filter({ has: page.getByRole('heading', { name: 'Legacy title' }) });
  await expect(legacy.locator('img')).toHaveJSProperty('naturalWidth', 1);
  await expect(legacy.getByTestId('book-author')).toHaveText('One author');
  const broken = page.getByTestId('book-card').filter({ has: page.getByRole('heading', { name: 'Kept title' }) });
  await expect(broken.locator('img')).toHaveCount(0);
  await expect(broken.getByText('EPUB', { exact: true })).toBeVisible();
  await expect(page.getByText('Не удалось прочитать сведения о книге.')).toBeVisible();
  await page.getByLabel('Язык').selectOption('en');
  await expect(page.getByText('Could not read book information.')).toBeVisible();
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});

test('parses namespace prefixes, encoded paths and text without inserting EPUB markup', async ({ page }) => {
  await page.goto('/');
  const epub = await makeEpub({
    opf: '<o:package xmlns:o="http://www.idpf.org/2007/opf"><o:metadata xmlns:d="http://purl.org/dc/elements/1.1/"><d:title>  A &amp; B  </d:title><d:creator> Alice </d:creator><d:creator>Bob</d:creator></o:metadata><o:manifest><o:item id="c" properties="cover-image" href="../Images/%D0%BA%D0%BD%D0%B8%D0%B3%D0%B0.png" media-type="text/plain"/></o:manifest></o:package>',
    coverPath: 'Images/книга.png',
  });
  expect(await parse(page, epub)).toMatchObject({ title: 'A & B', author: 'Alice, Bob', mime: 'image/png' });
  await page.getByLabel('Выбрать EPUB').setInputFiles({ name: 'literal.epub', mimeType: 'application/epub+zip', buffer: await makeEpub({ title: '<img src=x onerror=alert(1)>', coverHref: null }) });
  await expect(page.getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true })).toBeVisible();
  await expect(page.getByTestId('book-card').locator('img')).toHaveCount(0);
});

test('keeps metadata when covers are missing, external, SVG, oversized or unsupported', async ({ page }) => {
  await page.goto('/');
  for (const coverHref of [null, 'missing.png', 'https://example.invalid/cover.png', '%2F%2Fexample.invalid/cover.png', '../../../outside.png']) {
    const result = await parse(page, await makeEpub({ coverHref }));
    expect(result).toMatchObject({ title: 'Настоящее название', author: 'Первый автор, Второй автор' });
    expect(result).not.toHaveProperty('mime', 'image/png');
    expect(result.error).toBeUndefined();
  }
  for (const cover of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'not an image', new Uint8Array(8 * 1024 * 1024 + 1)]) {
    const result = await parse(page, await makeEpub({ cover }));
    expect(result.title).toBe('Настоящее название');
    expect(result.mime).toBeUndefined();
  }
  for (const [cover, mime] of [
    [new Uint8Array([255, 216, 255]), 'image/jpeg'],
    ['GIF89a', 'image/gif'],
    ['RIFFxxxxWEBP', 'image/webp'],
  ] as const) {
    const result = await parse(page, await makeEpub({ cover }));
    expect(result.mime).toBe(mime);
  }
  const withoutTitle = await parse(page, await makeEpub({ title: '', authors: [], coverHref: null }));
  expect(withoutTitle.title).toBeUndefined();
  expect(withoutTitle.author).toBeUndefined();
});

test('rejects unsafe, malformed and oversized XML and unsafe package paths', async ({ page }) => {
  await page.goto('/');
  const cases = [
    { options: { opf: '<!DOCTYPE package [<!ENTITY e SYSTEM "file:///private">]><package>&e;</package>' }, error: 'unsafe-xml' },
    { options: { opf: '<package><broken></package>' }, error: 'invalid-xml' },
    { options: { opf: '<html/>' }, error: 'invalid-package' },
    { options: { opf: '<package>' + ' '.repeat(2 * 1024 * 1024) + '</package>' }, error: 'resource-too-large' },
    { options: { container: '<container>' + ' '.repeat(2 * 1024 * 1024) + '</container>' }, error: 'resource-too-large' },
    { options: { container: '<container><rootfile full-path="https%3A//example.invalid/book.opf"/></container>' }, error: 'invalid-path' },
    { options: { container: '<container><rootfile full-path="%2e%2e/outside.opf"/></container>' }, error: 'archive-traversal' },
    { options: { container: '<container/>' }, error: 'missing-package' },
  ];
  for (const entry of cases) expect(await parse(page, await makeEpub(entry.options))).toMatchObject({ error: entry.error });
});

test('loads cards only after visibility and releases cover URLs on hide, clear and close', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 736 });
  await page.addInitScript(() => {
    const stats = { reads: [] as string[], created: [] as string[], revoked: [] as string[] };
    Object.assign(window, { metadataStats: stats });
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () { stats.reads.push(this.name); return read.call(this); };
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = blob => { const url = create(blob); stats.created.push(url); return url; };
    URL.revokeObjectURL = url => { stats.revoked.push(url); revoke(url); };
  });
  await page.goto('/');
  const buffer = await makeEpub();
  await page.getByLabel('Выбрать EPUB').setInputFiles(Array.from({ length: 40 }, (_, i) => ({ name: `book-${i}.epub`, mimeType: 'application/epub+zip', buffer })));
  const first = page.getByTestId('book-card').first();
  const last = page.getByTestId('book-card').last();
  await expect(first.getByRole('heading')).toHaveText('Настоящее название');
  const initial = await page.evaluate(() => (window as unknown as { metadataStats: { reads: string[] } }).metadataStats.reads);
  expect(initial.length).toBeLessThan(40);
  expect(initial).not.toContain('book-39.epub');
  await last.scrollIntoViewIfNeeded();
  await expect(last.getByRole('heading')).toHaveText('Настоящее название');
  await expect(first.locator('img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Закрыть view', exact: true }).click();
  await expect(page.getByTestId('library')).toHaveCount(0);
  const stats = await page.evaluate(() => (window as unknown as { metadataStats: { created: string[]; revoked: string[] } }).metadataStats);
  expect(stats.created.length).toBeGreaterThan(0);
  expect([...stats.revoked].sort()).toEqual([...stats.created].sort());
  await page.getByRole('button', { name: 'Открыть view', exact: true }).click();
  await page.getByRole('button', { name: 'Очистить список', exact: true }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a file read finishing after close cannot update the closed view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    let delayed = false;
    File.prototype.arrayBuffer = async function () {
      const data = await read.call(this);
      if (delayed) return data;
      delayed = true;
      return new Promise<ArrayBuffer>(resolve => { Object.assign(window, { releaseMetadataRead: () => resolve(data) }); });
    };
  });
  await page.goto('/');
  await page.getByLabel('Выбрать EPUB').setInputFiles({ name: 'delayed.epub', mimeType: 'application/epub+zip', buffer: await makeEpub() });
  await expect(page.getByTestId('book-card')).toHaveAttribute('aria-busy', 'true');
  await page.waitForFunction(() => 'releaseMetadataRead' in window);
  await page.getByRole('button', { name: 'Закрыть view', exact: true }).click();
  await page.evaluate(() => (window as unknown as { releaseMetadataRead: () => void }).releaseMetadataRead());
  await expect(page.getByTestId('library')).toHaveCount(0);
  await page.getByRole('button', { name: 'Открыть view', exact: true }).click();
  await expect(page.getByTestId('book-card').getByRole('heading')).toHaveText('Настоящее название');
  expect(errors).toEqual([]);
});
