import { expect, test } from '@playwright/test';
import { makeEpub } from '../fixtures/epub';

test('searches known titles and authors, sorts, clears search and distinguishes empty from no results', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Файлы EPUB не найдены.', { exact: true })).toBeVisible();
  const search = page.getByRole('searchbox');
  await search.fill('нет');
  await expect(page.getByText('По вашему запросу книги не найдены.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await expect(search).toBeFocused();
  await page.getByLabel('Выбрать EPUB').setInputFiles([
    { name: 'a.epub', mimeType: 'application/epub+zip', buffer: await makeEpub({ title: 'Ёжик', authors: ['Борис'] }) },
    { name: 'b.epub', mimeType: 'application/epub+zip', buffer: await makeEpub({ title: 'Атлас', authors: ['Яна'] }) },
    { name: 'c.epub', mimeType: 'application/epub+zip', buffer: await makeEpub({ title: 'Йога', authors: ['Алиса'] }) },
  ]);
  const titles = page.getByTestId('book-card').getByRole('heading');
  await expect(titles).toHaveText(['Ёжик', 'Атлас', 'Йога']);
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(titles).toHaveText(['Атлас', 'Ёжик', 'Йога']);
  await search.fill(' ЕЖИК ');
  await expect(titles).toHaveText(['Ёжик']);
  await search.fill('алиса');
  await expect(titles).toHaveText(['Йога']);
  await search.fill('И\u0306ОГА');
  await expect(titles).toHaveText(['Йога']);
  await search.fill('несуществующая книга');
  await expect(page.getByText('По вашему запросу книги не найдены.')).toBeVisible();
  await expect(page.getByText('Файлы EPUB не найдены.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Очистить поиск', exact: true }).click();
  await expect(search).toBeFocused();
  await page.getByRole('combobox', { name: 'Сортировать по', exact: true }).selectOption('author');
  await expect(titles).toHaveText(['Йога', 'Ёжик', 'Атлас']);
  await page.getByRole('combobox', { name: 'Сортировать по', exact: true }).selectOption('title');
  await expect(titles).toHaveText(['Атлас', 'Ёжик', 'Йога']);
});

test('details support keyboard, focus return, inside padding and outside dismissal without closing on a drag', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Выбрать EPUB').setInputFiles({ name: 'atlas.epub', mimeType: 'application/epub+zip', buffer: await makeEpub({ title: 'Атлас' }) });
  const trigger = page.getByRole('button', { name: 'Сведения о книге «Атлас»', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Сведения о книге', exact: true });
  const close = dialog.getByRole('button', { name: 'Закрыть', exact: true });
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await expect(dialog.getByText('atlas.epub', { exact: true })).toHaveCount(2);
  await expect(dialog.getByText('EPUB', { exact: true })).toBeVisible();
  const bounds = await dialog.boundingBox();
  if (!bounds) throw new Error('Missing dialog bounds');
  await page.mouse.click(bounds.x + 3, bounds.y + bounds.height - 3);
  await expect(dialog).toBeVisible();
  await page.mouse.move(bounds.x + 40, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await close.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await close.click();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test('shows safe errors and retries valid data in an open details dialog', async ({ page }) => {
  await page.addInitScript(() => {
    let failed = false;
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name === 'retry.epub' && !failed) { failed = true; return Promise.reject(new Error('private low-level error')); }
      return read.call(this);
    };
  });
  await page.goto('/');
  await page.getByLabel('Выбрать EPUB').setInputFiles({ name: 'retry.epub', mimeType: 'application/epub+zip', buffer: await makeEpub({ title: 'Восстановленная книга' }) });
  await expect(page.getByRole('alert')).toHaveText('Не удалось прочитать сведения о книге.');
  await expect(page.getByText('private low-level error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Сведения о книге «retry»', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(dialog.getByRole('heading', { name: 'Восстановленная книга', exact: true })).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
});

test('explains an oversized EPUB and rejects it before binary reading, including retry', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
    if (!nativeSize) throw new Error('Missing native Blob size getter');
    Object.defineProperty(File.prototype, 'size', { get() { return this.name === 'huge.epub' ? 129 * 1024 * 1024 : nativeSize.call(this); } });
    Object.assign(window, { hugeReads: 0 });
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name === 'huge.epub') (window as unknown as { hugeReads: number }).hugeReads++;
      return read.call(this);
    };
  });
  await page.goto('/');
  await page.getByLabel('Выбрать EPUB').setInputFiles({ name: 'huge.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('small synthetic payload') });
  await expect(page.getByRole('alert')).toHaveText('Размер EPUB превышает ограничение 128 МиБ.');
  await page.getByRole('button', { name: 'Сведения о книге «huge»', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('129 МиБ', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Размер EPUB превышает ограничение 128 МиБ.');
  expect(await page.evaluate(() => (window as unknown as { hugeReads: number }).hugeReads)).toBe(0);
});

test('details and controls fit narrow screens and use both locales', async ({ page }, testInfo) => {
  const title = 'Длинное название книги для проверки переноса текста';
  const filename = 'очень-длинное-имя-файла-для-проверки-переноса-'.repeat(4) + '.epub';
  await page.goto('/');
  await page.getByLabel('Выбрать EPUB').setInputFiles({ name: filename, mimeType: 'application/epub+zip', buffer: await makeEpub({ title, authors: ['Очень длинное имя автора книги'] }) });
  const trigger = page.getByRole('button', { name: `Сведения о книге «${title}»`, exact: true });
  await expect(trigger).toBeVisible();
  for (const width of [320, 375, 736, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect(bounds?.y).toBeGreaterThanOrEqual(0);
    expect((bounds?.y ?? 800) + (bounds?.height ?? 800)).toBeLessThanOrEqual(800);
    expect((bounds?.x ?? width) + (bounds?.width ?? width)).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (width === 375 || width === 1024) await page.screenshot({ path: testInfo.outputPath(`details-${width}.png`), fullPage: false });
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
  await page.getByLabel('Язык').selectOption('en');
  await expect(page.getByRole('searchbox', { name: 'Search by title or author' })).toBeVisible();
  await page.getByRole('button', { name: `Details for ${title}`, exact: true }).click();
  const english = page.getByRole('dialog', { name: 'Book details', exact: true });
  await expect(english.getByText('File', { exact: true })).toBeVisible();
  await expect(english.getByText('Path', { exact: true })).toBeVisible();
  await expect(english.getByText('Size', { exact: true })).toBeVisible();
  await english.getByRole('button', { name: 'Close', exact: true }).click();
});

test('a host catalog change closes details of a removed book and returns focus to search', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Выбрать EPUB').setInputFiles({ name: 'atlas.epub', mimeType: 'application/epub+zip', buffer: await makeEpub({ title: 'Атлас' }) });
  await page.getByRole('button', { name: 'Сведения о книге «Атлас»', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // Simulate an external catalog change through the harness, bypassing inert background UI.
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Очистить список')?.click());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('book-card')).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toBeFocused();
  expect(errors).toEqual([]);
});


test('background indexing keeps card order stable and does not create covers for hidden cards', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.addInitScript(() => {
    const reads: string[] = [];
    Object.assign(window, { stableOrderReads: reads });
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () { reads.push(this.name); return read.call(this); };
  });
  await page.goto('/');
  const buffer = await makeEpub({ title: 'Zoo', authors: [] });
  await page.getByLabel('Выбрать EPUB').setInputFiles(Array.from({ length: 40 }, (_, i) => ({ name: `book-${i}.epub`, mimeType: 'application/epub+zip', buffer })));
  await expect(page.getByTestId('book-card').first().getByRole('heading')).toHaveText('Zoo');
  await expect(page.getByTestId('index-progress')).toHaveCount(0);
  await expect(page.getByTestId('book-card').getByRole('heading')).toHaveText(Array(40).fill('Zoo'));
  const reads = await page.evaluate(() => (window as unknown as { stableOrderReads: string[] }).stableOrderReads);
  expect(reads).toHaveLength(40);
  expect(new Set(reads).size).toBe(40);
  await expect(page.getByTestId('book-card').last().locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.getByTestId('book-path')).toHaveText(Array.from({ length: 40 }, (_, i) => `book-${i}.epub`));
});
