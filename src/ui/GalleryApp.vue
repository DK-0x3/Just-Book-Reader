<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { onMounted, onUnmounted, shallowRef } from 'vue';
import type { LibraryService } from '../app/library-service';
import type { LibrarySnapshot } from '../domain/library';
import BookCard from './BookCard.vue';

const props = defineProps<{ service: LibraryService }>();
const service = props.service;
const { t } = useI18n({ useScope: 'global' });
const snapshot = shallowRef<LibrarySnapshot>({ books: [], scanning: true });
let stop: (() => void) | undefined;

onMounted(() => {
  stop = service.subscribe(value => { snapshot.value = value; });
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
        <button :class="$style.refresh" type="button" :disabled="snapshot.scanning" @click="service.scan()">
          {{ t('library.refresh') }}
        </button>
      </header>
      <p v-if="snapshot.scanning" :class="$style.status" role="status">{{ t('library.scanning') }}</p>
      <p v-if="snapshot.error" :class="$style.error" role="alert">{{ t('library.error') }}</p>
      <div v-if="!snapshot.scanning && !snapshot.error && !snapshot.books.length" :class="$style.empty">
        <p>{{ t('library.empty') }}</p>
        <p :class="$style.caption">{{ t('library.emptyHint') }}</p>
      </div>
      <ul v-if="snapshot.books.length" :class="$style.grid" :aria-label="t('library.books')">
        <li v-for="book in snapshot.books" :key="book.path">
          <BookCard :book="book" @visibility="(path, visible) => service.setVisible(path, visible)" />
        </li>
      </ul>
    </div>
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

.refresh {
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
