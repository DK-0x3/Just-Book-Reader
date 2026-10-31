<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { LibraryService } from '../app/library-service';
import { filterBooks, type Book, type BookSort, type LibrarySnapshot } from '../domain/library';
import BookCard from './BookCard.vue';
import BookDetails from './BookDetails.vue';

const props = defineProps<{ service: LibraryService }>();
const service = props.service;
const { t } = useI18n({ useScope: 'global' });
const snapshot = shallowRef<LibrarySnapshot>({ books: [], scanning: true });
const query = ref('');
const sort = ref<BookSort>('title');
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
let stop: (() => void) | undefined;

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
watch(selectedBook, book => { if (selectedPath.value && !book) closeDetails(); });

onMounted(() => {
  stop = service.subscribe(value => { snapshot.value = value; reconcileOrder(value.books); });
  void service.scan();
});
onUnmounted(() => { stop?.(); });
</script>

<template>
  <section :class="$style.jbrGallery" :aria-busy="snapshot.scanning" data-testid="library">
    <div :class="$style.page">
      <header :class="$style.heading">
        <div>
          <p :class="$style.eyebrow">Just Book Reader</p>
          <h1 :class="$style.title">{{ t('library.title') }}</h1>
        </div>
        <button :class="$style.refresh" type="button" :disabled="snapshot.scanning" @click="refresh">
          {{ t('library.refresh') }}
        </button>
      </header>
      <div :class="$style.toolbar">
        <div :class="$style.search">
          <input ref="searchInput" v-model="query" type="search" :aria-label="t('library.search')" :placeholder="t('library.search')" />
          <button v-if="query" :class="$style.control" type="button" @click="clearSearch">{{ t('library.clearSearch') }}</button>
        </div>
        <label :class="$style.sort">
          <span>{{ t('library.sort') }}</span>
          <select v-model="sort" :aria-label="t('library.sort')">
            <option value="title">{{ t('library.sortTitle') }}</option>
            <option value="author">{{ t('library.sortAuthor') }}</option>
          </select>
        </label>
      </div>
      <p v-if="snapshot.scanning" :class="$style.status" role="status">{{ t('library.scanning') }}</p>
      <p v-if="snapshot.error" :class="$style.error" role="alert">{{ t('library.error') }}</p>
      <p v-if="snapshot.cacheError" :class="$style.error" role="alert">{{ t('library.cacheError') }}</p>
      <p v-if="indexingActive" :class="$style.status" role="status" data-testid="index-progress">
        {{ t('library.indexing', { done: (indexing?.completed ?? 0) + (indexing?.failed ?? 0), total: indexing?.total ?? 0 }) }}
        {{ t('library.searchIncomplete') }}
      </p>
      <p v-else-if="indexing?.failed" :class="$style.status" role="status">{{ t('library.indexErrors', { count: indexing.failed }) }}</p>
      <div v-if="!snapshot.scanning && !snapshot.error && !snapshot.books.length" :class="$style.empty">
        <p>{{ t('library.empty') }}</p>
        <p :class="$style.caption">{{ t('library.emptyHint') }}</p>
      </div>
      <div v-else-if="!snapshot.scanning && snapshot.books.length && !books.length" :class="$style.empty" role="status">
        <p>{{ t(searchIncomplete ? 'library.noResultsYet' : 'library.noResults') }}</p>
      </div>
      <ul v-if="books.length" :class="$style.grid" :aria-label="t('library.books')">
        <li v-for="book in books" :key="book.path">
          <BookCard :book="book" @visibility="(path, visible) => service.setVisible(path, visible)"
            @select="openDetails" @retry="path => service.retryMetadata(path)" />
        </li>
      </ul>
    </div>
    <BookDetails v-if="selectedBook" :key="selectedBook.path" :book="selectedBook"
      @close="closeDetails" @retry="path => service.retryMetadata(path)" />
  </section>
</template>

<style module lang="scss">
.jbrGallery {
  background: var(--background-primary);
  color: var(--text-normal);
  font: 14px/1.5 var(--font-interface, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  min-height: 100%;

  &, *, *::before, *::after {
    box-sizing: border-box;
  }
}

.page {
  max-width: 1280px;
  margin: auto;
  padding: 42px 40px;

  @media (max-width: 600px) {
    padding: 28px 20px;
  }
}

.heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 34px;
}

.refresh, .control {
  font: inherit;
  color: var(--text-normal);
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  min-height: 42px;
  padding: 8px 16px;
  cursor: pointer;

  &:disabled {
    opacity: .6;
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--text-normal);
    outline-offset: 2px;
  }
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

  input { flex: 1; min-width: 0; width: 100%; }
}
.sort {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}
.search input, .sort select {
  box-sizing: border-box;
  max-width: 100%;
  min-height: 42px;
  padding: 8px 12px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  color: var(--text-normal);
  background: var(--background-primary);
  font: inherit;
}
.status, .error {
  margin: 0 0 24px;
  color: var(--text-muted);
}

.error {
  padding: 16px;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
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
  color: var(--text-muted);
}

.title {
  margin: 0;
  font-size: 30px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--text-normal);
}

.empty {
  padding: 40px 20px;
  text-align: center;
  border: 1px solid var(--background-modifier-border);
  border-radius: 12px;

  p {
    margin: 0;
  }

  .caption {
    margin-top: 8px;
    color: var(--text-muted);
  }
}
</style>
