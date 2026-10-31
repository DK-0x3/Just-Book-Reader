import { expect, test, type Page } from '@playwright/test';
import { makeEpub } from '../fixtures/epub';

async function storedIndex(page: Page): Promise<string | undefined> {
  return page.evaluate(() => new Promise<string | undefined>((resolve, reject) => {
    const opening = indexedDB.open('just-book-reader-dev-cache', 1);
    opening.onsuccess = () => {
      const db = opening.result;
      const request = db.transaction('cache').objectStore('cache').get('index');
      request.onsuccess = () => { resolve(request.result); db.close(); };
      request.onerror = () => reject(request.error);
    };
    opening.onerror = () => reject(opening.error);
  }));
}
async function selectStableFile(page: Page, buffer: Buffer): Promise<void> {
  await page.getByLabel('Выбрать EPUB').evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], '001.epub', { type: 'application/epub+zip', lastModified: 1234 }));
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, buffer.toString('base64'));
}

test('search discovers hidden metadata while showing progress and reads each EPUB only once', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 736 });
  await page.addInitScript(() => {
    const stats = { reads: [] as string[] };
    Object.assign(window, { indexStats: stats });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    Object.assign(window, { releaseIndex: release });
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () { stats.reads.push(this.name); const data = await read.call(this); await gate; return data; };
  });
  await page.goto('/');
  const buffer = await makeEpub({ title: 'Война и мир', authors: ['Лев Толстой'] });
  await page.getByLabel('Выбрать EPUB').setInputFiles(Array.from({ length: 30 }, (_, i) => ({ name: `${i}.epub`, mimeType: 'application/epub+zip', buffer })));
  await expect(page.getByTestId('index-progress')).toContainText('Результаты поиска пока неполные.');
  await page.getByRole('searchbox').fill('ТОЛСТОЙ');
  await expect(page.getByText('Среди обработанных книг совпадений пока нет.')).toBeVisible();
  await page.evaluate(() => (window as unknown as { releaseIndex: () => void }).releaseIndex());
  await expect(page.getByTestId('book-card')).toHaveCount(30);
  await expect(page.getByTestId('index-progress')).toHaveCount(0);
  await expect(page.getByTestId('book-card').last().locator('img')).toHaveCount(0);
  const reads = await page.evaluate(() => (window as unknown as { indexStats: { reads: string[] } }).indexStats.reads);
  expect(reads).toHaveLength(30);
  expect(new Set(reads).size).toBe(30);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('restores IndexedDB metadata and covers after a page reload without reading an unchanged EPUB', async ({ page }) => {
  await page.addInitScript(() => {
    const stats = { reads: 0 };
    Object.assign(window, { warmStats: stats });
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () { stats.reads++; return read.call(this); };
  });
  await page.goto('/');
  const buffer = await makeEpub({ title: 'Сохранённая книга', authors: ['Автор'] });
  await selectStableFile(page, buffer);
  await expect(page.getByTestId('book-card').getByRole('heading')).toHaveText('Сохранённая книга');
  await expect(page.getByTestId('book-card').locator('img')).toHaveJSProperty('naturalWidth', 1);
  await expect.poll(async () => JSON.parse(await storedIndex(page) ?? '{"books":[]}').books.length).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { warmStats: { reads: number } }).warmStats.reads)).toBe(1);
  await page.reload();
  await expect(page.getByText('Файлы EPUB не найдены.', { exact: true })).toBeVisible();
  await selectStableFile(page, buffer);
  await expect(page.getByTestId('book-card').getByRole('heading')).toHaveText('Сохранённая книга');
  await expect(page.getByTestId('book-card').locator('img')).toHaveJSProperty('naturalWidth', 1);
  expect(await page.evaluate(() => (window as unknown as { warmStats: { reads: number } }).warmStats.reads)).toBe(0);
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { warmStats: { reads: number } }).warmStats.reads)).toBe(0);
  await page.getByRole('button', { name: 'Очистить список', exact: true }).click();
  await expect.poll(async () => JSON.parse(await storedIndex(page) ?? '{"books":[{}]}').books.length).toBe(0);
});

test('preserves a future cache index and explains that caching is unavailable', async ({ page }) => {
  await page.goto('/');
  const future = '{"version":99,"books":[],"futureData":"keep"}';
  await page.evaluate(json => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open('just-book-reader-dev-cache', 1);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').put(json, 'index');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    opening.onerror = () => reject(opening.error);
  }), future);
  await page.reload();
  await expect(page.getByRole('alert')).toHaveText('Кэш недоступен. Поиск работает в текущем окне, но данные могут загружаться повторно.');
  await selectStableFile(page, await makeEpub({ title: 'Работает без кэша' }));
  await expect(page.getByTestId('book-card').getByRole('heading')).toHaveText('Работает без кэша');
  await page.getByRole('button', { name: 'Закрыть view', exact: true }).click();
  expect(await storedIndex(page)).toBe(future);
});
