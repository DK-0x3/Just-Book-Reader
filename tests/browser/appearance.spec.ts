import { expect, test, type Page } from '@playwright/test';
import { makeEpub } from '../fixtures/epub';

const key = 'just-book-reader-preferences';

async function choose(page: Page, label: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Тема', exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function saved(page: Page, profile: string): Promise<string | undefined> {
  return page.evaluate(({ key, profile }) => JSON.parse(localStorage.getItem(key) ?? '{}').profiles?.[profile]?.galleryTheme, { key, profile });
}

test('persists themes across reload and view reopen with independent desktop/mobile profiles', async ({ page }) => {
  await page.goto('/');
  const library = page.getByTestId('library');
  await expect(library).toHaveAttribute('data-device', 'desktop');
  await choose(page, 'Сепия');
  await expect.poll(() => saved(page, 'desktop')).toBe('sepia');
  await page.getByRole('button', { name: 'Закрыть view', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть view', exact: true }).click();
  await expect(library).toHaveAttribute('data-theme', 'sepia');
  await page.reload();
  await expect(library).toHaveAttribute('data-theme', 'sepia');
  await page.goto('/?device=mobile');
  await expect(library).toHaveAttribute('data-device', 'mobile');
  await expect(library).toHaveAttribute('data-theme', 'obsidian');
  await choose(page, 'E-ink');
  await expect.poll(() => saved(page, 'mobile')).toBe('eink');
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(library).toHaveAttribute('data-device', 'mobile');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(library).toHaveAttribute('data-device', 'mobile');
  await page.goto('/');
  await expect(library).toHaveAttribute('data-theme', 'sepia');
  expect(await saved(page, 'mobile')).toBe('eink');
});

test('combobox supports arrows, Home/End, confirmation, cancellation, Tab and focus', async ({ page }) => {
  await page.goto('/');
  const theme = page.getByRole('combobox', { name: 'Тема', exact: true });
  const library = page.getByTestId('library');
  await theme.focus();
  await page.keyboard.press('Enter');
  await expect(theme).toHaveAttribute('aria-expanded', 'true');
  await expect(theme).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox').getByRole('option', { selected: true })).toHaveText('Тёмная');
  await expect(library).toHaveAttribute('data-theme', 'obsidian');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(theme).toBeFocused();
  await theme.press('End');
  await expect(page.getByRole('listbox').getByRole('option', { selected: true })).toHaveText('E-ink');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox').getByRole('option', { selected: true })).toHaveText('E-ink');
  await page.keyboard.press('Enter');
  await expect(library).toHaveAttribute('data-theme', 'eink');
  await expect(theme).toBeFocused();
  await theme.press('Home');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('listbox').getByRole('option', { selected: true })).toHaveText('Obsidian');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(library).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeFocused();
  await theme.click();
  await page.getByRole('option', { name: 'Светлая', exact: true }).hover();
  await page.getByRole('searchbox').click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(library).toHaveAttribute('data-theme', 'dark');
});

test('typeahead handles sequences, repeated Cyrillic characters and translated labels', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Язык').selectOption('en');
  let theme = page.getByRole('combobox', { name: 'Theme', exact: true });
  await theme.focus();
  await page.keyboard.press('l');
  await page.keyboard.press('i');
  await expect(page.getByRole('listbox').getByRole('option', { selected: true })).toHaveText('Light');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('library')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Language').selectOption('ru');
  theme = page.getByRole('combobox', { name: 'Тема', exact: true });
  await theme.focus();
  // Playwright's keyboard map has no Cyrillic key; exercise the resulting DOM key event.
  await theme.dispatchEvent('keydown', { key: 'с', code: 'KeyC', bubbles: true, cancelable: true });
  await expect(page.getByRole('listbox').getByRole('option', { selected: true })).toHaveText('Сепия');
  await theme.dispatchEvent('keydown', { key: 'с', code: 'KeyC', bubbles: true, cancelable: true });
  await expect(page.getByRole('listbox').getByRole('option', { selected: true })).toHaveText('Светлая');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('library')).toHaveAttribute('data-theme', 'light');
});

test('menus stay within viewport bounds, scroll active options and clean up on view close', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const theme = page.getByRole('combobox', { name: 'Тема', exact: true });
  for (const width of [320, 375, 736, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await theme.click();
    const menu = page.getByRole('listbox', { name: 'Тема', exact: true });
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 320) await page.screenshot({ path: testInfo.outputPath('menu-320.png') });
    await theme.press('Escape');
  }
  await page.setViewportSize({ width: 1024, height: 260 });
  await theme.click();
  await theme.press('End');
  const menu = page.getByRole('listbox');
  await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const active = await page.getByRole('listbox').getByRole('option', { selected: true }).boundingBox();
  const bounds = await menu.boundingBox();
  expect(active!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(active!.y + active!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
  await page.getByRole('button', { name: 'Закрыть view', exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(() => dispatchEvent(new Event('scroll')));
  await page.getByRole('button', { name: 'Открыть view', exact: true }).click();
  await page.getByRole('combobox', { name: 'Тема', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Obsidian theme follows host variables while explicit themes stay local', async ({ page }) => {
  await page.goto('/');
  const library = page.getByTestId('library');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--background-primary', 'rgb(12, 34, 56)');
    document.documentElement.style.setProperty('--text-normal', 'rgb(240, 245, 250)');
  });
  await expect(library).toHaveCSS('background-color', 'rgb(12, 34, 56)');
  await expect(library).toHaveCSS('color', 'rgb(240, 245, 250)');
  const host = await page.locator('.dev-toolbar').evaluate(element => getComputedStyle(element).backgroundColor);
  await choose(page, 'Светлая');
  await expect(library).toHaveCSS('background-color', 'rgb(246, 247, 251)');
  await expect(page.locator('.dev-toolbar')).toHaveCSS('background-color', host);
  await choose(page, 'Obsidian');
  await expect(library).toHaveCSS('background-color', 'rgb(12, 34, 56)');
});

test('e-ink removes shadows and motion; reduced-motion also prevents card movement', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Выбрать EPUB').setInputFiles({ name: 'motion.epub', mimeType: 'application/epub+zip', buffer: await makeEpub({ title: 'Без движения', coverHref: null }) });
  const card = page.getByTestId('book-card');
  const cover = card.locator('div[aria-hidden="true"]');
  await choose(page, 'E-ink');
  await card.hover();
  await expect(cover).toHaveCSS('transform', 'none');
  await expect(cover).toHaveCSS('box-shadow', 'none');
  await expect(cover).toHaveCSS('transition-duration', '0s');
  await page.getByRole('combobox', { name: 'Тема', exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCSS('box-shadow', 'none');
  await page.keyboard.press('Escape');
  await choose(page, 'Тёмная');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await card.hover();
  await expect(cover).toHaveCSS('transform', 'none');
  await expect(cover).toHaveCSS('transition-duration', '0s');
});

test('failed saving restores the previous theme, preserves data and allows retry', async ({ page }) => {
  const data = { schemaVersion: 1, keep: ['untouched'], profiles: { desktop: { galleryTheme: 'light', extra: 7 }, mobile: { galleryTheme: 'eink' } } };
  await page.addInitScript(({ key, data }) => {
    localStorage.setItem(key, JSON.stringify(data));
    Object.assign(window, { failPreferences: true });
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) {
      if (name === key && (window as unknown as {
        failPreferences: boolean;
      }).failPreferences) throw new Error('private write detail');
      write.call(this, name, value);
    };
  }, { key, data });
  await page.goto('/');
  await expect(page.getByTestId('library')).toHaveAttribute('data-theme', 'light');
  await choose(page, 'Сепия');
  await expect(page.getByRole('alert')).toHaveText('Не удалось сохранить тему. Возвращена предыдущая тема.');
  await expect(page.getByTestId('library')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('combobox', { name: 'Тема', exact: true })).toBeFocused();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? ''), key)).toEqual(data);
  await page.evaluate(() => {
    (window as unknown as {
      failPreferences: boolean;
    }).failPreferences = false;
  });
  await choose(page, 'Тёмная');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => saved(page, 'desktop')).toBe('dark');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? ''), key)).toEqual({ ...data, profiles: { ...data.profiles, desktop: { galleryTheme: 'dark', extra: 7 } } });
});

for (const raw of ['{broken', 'null', '{"schemaVersion":99,"future":"keep"}']) {
  test(`preserves invalid or future settings: ${raw}`, async ({ page }) => {
    await page.addInitScript(({ key, raw }) => {
      localStorage.setItem(key, raw);
    }, { key, raw });
    await page.goto('/');
    await expect(page.getByRole('alert')).toHaveText('Не удалось загрузить настройки. Сохранённые данные не изменены.');
    await choose(page, 'Тёмная');
    await expect(page.getByRole('alert')).toHaveText('Не удалось сохранить тему. Возвращена предыдущая тема.');
    await expect(page.getByTestId('library')).toHaveAttribute('data-theme', 'obsidian');
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  });
}

test('all five themes style cards, controls, popups and details consistently', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.goto('/');
  await page.getByLabel('Выбрать EPUB').setInputFiles(await Promise.all([
    ['Атлас тихих мест', 'Мария Волкова'], ['Записки путешественника', 'Алексей Лесков'], ['История одного города', 'Елена Соколова'],
    ['Наука повседневного', 'Иван Смирнов'], ['Письма издалека', 'Анна Белова'], ['Море и звёзды', 'Дмитрий Орлов'],
  ].map(async ([title, author], index) => ({ name: `example-${index}.epub`, mimeType: 'application/epub+zip', buffer: await makeEpub({ title, authors: [author ?? ''], coverHref: null }) }))));
  await expect(page.getByTestId('book-card').getByRole('heading')).toHaveText(['Атлас тихих мест', 'Записки путешественника', 'История одного города', 'Наука повседневного', 'Письма издалека', 'Море и звёзды']);
  await expect(page.getByTestId('index-progress')).toHaveCount(0);
  for (const [theme, label] of [['obsidian', 'Obsidian'], ['dark', 'Тёмная'], ['light', 'Светлая'], ['sepia', 'Сепия'], ['eink', 'E-ink']]) {
    if (theme !== 'obsidian') await choose(page, label!);
    const library = page.getByTestId('library');
    await expect(library).toHaveAttribute('data-theme', theme!);
    await page.screenshot({ path: testInfo.outputPath(`theme-${theme}.png`) });
    await page.getByRole('combobox', { name: 'Тема', exact: true }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('book-card').first().getByRole('button').click();
    const dialog = page.getByRole('dialog');
    const colors = await library.evaluate(element => ({ bg: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).color }));
    await expect(dialog).toHaveCSS('background-color', colors.bg);
    await expect(dialog).toHaveCSS('color', colors.text);
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
});
