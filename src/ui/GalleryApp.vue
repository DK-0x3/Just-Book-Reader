<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { LibraryService } from '../app/library-service';
import { filterBooks, type Book, type BookSort, type LibrarySnapshot } from '../domain/library';
import BookCard from './BookCard.vue';
import BookDetails from './BookDetails.vue';
import SelectMenu from './SelectMenu.vue';
import Icon from './Icon.vue';
import type { PreferencesService } from '../app/preferences-service';
import { galleryThemes, isGalleryTheme } from '../domain/preferences';

const props = defineProps<{
  service: LibraryService;
  preferences: PreferencesService;
}>();
const service = props.service;
const preferences = props.preferences;
const appearance = shallowRef(preferences.snapshot());
const { t } = useI18n({ useScope: 'global' });
const snapshot = shallowRef<LibrarySnapshot>({ books: [], scanning: true });
const query = ref('');
const sort = ref<BookSort>('title');
const themeOptions = computed(() => galleryThemes.map(value => ({ value, label: t(`appearance.${value}`) })));
const sortOptions = computed(() => [
  { value: 'title', label: t('library.sortTitle') }, { value: 'author', label: t('library.sortAuthor') },
]);
const searchInput = ref<HTMLInputElement>();
const selectedPath = ref<string>();
const orderedPaths = ref<string[]>([]);
const books = computed(() => {
  const byPath = new Map(snapshot.value.books.map(book => [book.path, book]));
  const ordered = orderedPaths.value.flatMap(path => {
    const book = byPath.get(path);
    return book ? [book] : [];
  });
  return filterBooks(ordered, query.value);
});
const selectedBook = computed(() => snapshot.value.books.find(book => book.path === selectedPath.value));
const indexing = computed(() => snapshot.value.indexing);
const indexingActive = computed(() => indexing.value && indexing.value.completed + indexing.value.failed < indexing.value.total);
const searchIncomplete = computed(() => indexing.value && indexing.value.completed < indexing.value.total);
let detailsTrigger: HTMLButtonElement | undefined;
let stopLibrary: (() => void) | undefined;
let stopPreferences: (() => void) | undefined;

function changeTheme(value: string): void {
  if (isGalleryTheme(value)) void preferences.setTheme(value);
}

function changeSort(value: string): void {
  if (value === 'title' || value === 'author') sort.value = value;
}

function setBookVisibility(path: string, visible: boolean): void {
  service.setVisible(path, visible);
}

function retryMetadata(path: string): void {
  service.retryMetadata(path);
}

function sortBooks(): void {
  orderedPaths.value = filterBooks(snapshot.value.books, '', sort.value).map(book => book.path);
}

function reconcileOrder(current: readonly Book[]): void {
  const paths = new Set(current.map(book => book.path));
  const previous = new Set(orderedPaths.value);
  const retained = orderedPaths.value.filter(path => paths.has(path));
  const added = filterBooks(current.filter(book => !previous.has(book.path)), '', sort.value);
  if (retained.length !== orderedPaths.value.length || added.length) {
    orderedPaths.value = [...retained, ...added.map(book => book.path)];
  }
}

async function refresh(): Promise<void> {
  await service.scan();
  sortBooks();
}

watch(sort, sortBooks);

function clearSearch(): void {
  query.value = '';
  searchInput.value?.focus();
}

function openDetails(path: string, trigger: HTMLButtonElement): void {
  detailsTrigger = trigger;
  selectedPath.value = path;
}

function closeDetails(): void {
  selectedPath.value = undefined;
  void nextTick(() => {
    if (detailsTrigger?.isConnected) detailsTrigger.focus();
    else searchInput.value?.focus();
    detailsTrigger = undefined;
  });
}

watch(selectedBook, book => {
  if (selectedPath.value && !book) closeDetails();
});

onMounted(() => {
  stopPreferences = preferences.subscribe(value => {
    appearance.value = value;
  });
  stopLibrary = service.subscribe(value => {
    snapshot.value = value;
    reconcileOrder(value.books);
  });
  void service.scan();
});

onUnmounted(() => {
  stopLibrary?.();
  stopPreferences?.();
});
</script>

<template>
  <section
    class="jbr-gallery"
    :class="$style.jbrGallery"
    :data-theme="appearance.theme"
    :data-device="preferences.profile"
    :aria-busy="snapshot.scanning"
    data-testid="library"
  >
    <div :class="$style.page">
      <header :class="$style.heading">
        <div>
          <p :class="$style.eyebrow">Just Book Reader</p>
          <h1 :class="$style.title">{{ t('library.title') }}</h1>
        </div>
        <div :class="$style.actions">
          <div :class="[$style.field, $style.theme]">
            <span :class="$style.label">
              {{ t('appearance.theme') }}
              <span v-if="appearance.saving" role="status">· {{ t('appearance.saving') }}</span>
            </span>
            <SelectMenu
              :model-value="appearance.theme"
              :options="themeOptions"
              :label="t('appearance.theme')"
              icon="palette"
              :disabled="appearance.loading"
              @update:model-value="changeTheme"
            />
          </div>
          <button
            :class="$style.control"
            type="button"
            :disabled="snapshot.scanning"
            @click="refresh"
          >
            <Icon name="refresh" />
            {{ t('library.refresh') }}
          </button>
        </div>
      </header>
      <div :class="$style.toolbar">
        <div :class="$style.search">
          <label :class="$style.searchField">
            <Icon name="search" />
            <input
              ref="searchInput"
              v-model="query"
              type="search"
              :aria-label="t('library.search')"
              :placeholder="t('library.search')"
            />
          </label>
          <button
            v-if="query"
            :class="$style.control"
            type="button"
            :aria-label="t('library.clearSearch')"
            @click="clearSearch"
          >
            <Icon name="close" />
          </button>
        </div>
        <div :class="[$style.field, $style.sort]">
          <span :class="$style.label">{{ t('library.sort') }}</span>
          <SelectMenu
            :model-value="sort"
            :options="sortOptions"
            :label="t('library.sort')"
            icon="sort"
            @update:model-value="changeSort"
          />
        </div>
      </div>
      <p
        v-if="appearance.error"
        :class="$style.error"
        role="alert"
      >{{ t(appearance.error === 'load' ? 'appearance.loadError' : 'appearance.saveError') }}</p>
      <p
        v-if="snapshot.scanning"
        :class="$style.status"
        role="status"
      >{{ t('library.scanning') }}</p>
      <p
        v-if="snapshot.error"
        :class="$style.error"
        role="alert"
      >{{ t('library.error') }}</p>
      <p
        v-if="snapshot.cacheError"
        :class="$style.error"
        role="alert"
      >{{ t('library.cacheError') }}</p>
      <p
        v-if="indexingActive"
        :class="$style.status"
        role="status"
        data-testid="index-progress"
      >
        {{ t('library.indexing', { done: (indexing?.completed ?? 0) + (indexing?.failed ?? 0), total: indexing?.total ?? 0 }) }}
        {{ t('library.searchIncomplete') }}
      </p>
      <p
        v-else-if="indexing?.failed"
        :class="$style.status"
        role="status"
      >{{ t('library.indexErrors', { count: indexing.failed }) }}</p>
      <div
        v-if="!snapshot.scanning && !snapshot.error && !snapshot.books.length"
        :class="$style.empty"
      >
        <Icon name="book" />
        <p>{{ t('library.empty') }}</p>
        <p :class="$style.caption">{{ t('library.emptyHint') }}</p>
      </div>
      <div
        v-else-if="!snapshot.scanning && snapshot.books.length && !books.length"
        :class="$style.empty"
        role="status"
      >
        <p>{{ t(searchIncomplete ? 'library.noResultsYet' : 'library.noResults') }}</p>
      </div>
      <ul
        v-if="books.length"
        :class="$style.grid"
        :aria-label="t('library.books')"
      >
        <li v-for="book in books" :key="book.path">
          <BookCard
            :book="book"
            @visibility="setBookVisibility"
            @select="openDetails"
            @retry="retryMetadata"
          />
        </li>
      </ul>
    </div>
    <BookDetails
      v-if="selectedBook"
      :key="selectedBook.path"
      :book="selectedBook"
      @close="closeDetails"
      @retry="retryMetadata"
    />
  </section>
</template>

<style module lang="scss">
@use './controls';

.jbrGallery {
  background: var(--jbr-background);
  color: var(--jbr-text);
  font: 14px/1.5 var(--font-interface, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  min-height: 100%;

  &, *, *::before, *::after {
    box-sizing: border-box;
  }
}

.page {
  max-width: 1280px;
  margin: auto;
  padding: 40px;

  @media (max-width: 600px) {
    padding: 28px 20px;
  }
}

.heading {
  display: flex;
  justify-content: space-between;
  align-items: end;
  flex-wrap: wrap;
  gap: 24px;
  margin-bottom: 30px;
}

.actions {
  display: flex;
  align-items: end;
  gap: 12px;
  max-width: 100%;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

.label {
  color: var(--jbr-muted);
  font-size: 12px;
  font-weight: 500;
}

.theme {
  width: 190px;
}

.sort {
  flex: 0 1 190px;
}

.control {
  @include controls.control;
  flex: none;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 16px;
  margin-bottom: 28px;
}

.search {
  display: flex;
  align-items: center;
  flex: 1 1 260px;
  gap: 8px;
  min-width: 0;
}

.searchField {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 10px;
  min-height: 44px;
  padding: 0 13px;
  border: 1px solid var(--jbr-border);
  border-radius: 9px;
  color: var(--jbr-muted);
  background: var(--jbr-surface);

  &:focus-within {
    @include controls.focus;
  }

  input {
    appearance: none;
    flex: 1;
    min-width: 0;
    width: 100%;
    height: 42px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
    color: var(--jbr-text);
    font: inherit;

    &::placeholder {
      color: var(--jbr-muted);
      opacity: 1;
    }

    &:focus {
      border: 0;
      outline: none;
      box-shadow: none;
    }

    &::-webkit-search-cancel-button {
      appearance: none;
    }
  }
}

.status {
  margin: 0 0 24px;
  color: var(--jbr-muted);
}

.error {
  margin: 0 0 24px;
  padding: 14px 16px;
  border: 1px solid var(--jbr-border);
  border-radius: 9px;
  color: var(--jbr-text);
  background: var(--jbr-surface);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(150px, 100%), 1fr));
  gap: 28px 20px;
  list-style: none;
  padding: 0;
  margin: 0;

  > li {
    min-width: 0;
  }
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--jbr-muted);
  letter-spacing: .025em;
}

.title {
  margin: 0;
  font-size: 30px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--jbr-text);
}

.empty {
  padding: 48px 20px;
  text-align: center;
  border: 1px dashed var(--jbr-border);
  border-radius: 12px;
  background: var(--jbr-surface);

  > svg {
    width: 32px;
    height: 32px;
    margin: 0 auto 16px;
    color: var(--jbr-muted);
  }

  p {
    margin: 0;
  }

  .caption {
    margin-top: 8px;
    color: var(--jbr-muted);
  }
}

@media (max-width: 600px) {
  .actions {
    width: 100%;
  }

  .theme {
    flex: 1;
    width: auto;
  }

  .sort {
    flex: 1 1 190px;
  }
}
</style>
