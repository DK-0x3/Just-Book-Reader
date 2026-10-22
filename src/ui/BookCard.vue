<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Book } from '../domain/library';

const props = defineProps<{ book: Book }>();
const emit = defineEmits<{ visibility: [path: string, visible: boolean] }>();
const { t } = useI18n({ useScope: 'global' });

const card = ref<HTMLElement>();
const imageFailed = ref(false);
let observer: IntersectionObserver | undefined;

watch(() => props.book.coverUrl, () => { imageFailed.value = false; });
onMounted(() => {
  if (!card.value) return;
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) emit('visibility', props.book.path, entry.isIntersecting);
  });
  observer.observe(card.value);
});
onUnmounted(() => {
  observer?.disconnect();
  emit('visibility', props.book.path, false);
});
</script>

<template>
  <article ref="card" :class="$style.jbrBook" data-testid="book-card" :aria-busy="book.metadataStatus === 'loading'">
    <div :class="$style.cover" aria-hidden="true">
      <img v-if="book.coverUrl && !imageFailed" :class="$style.image" :src="book.coverUrl" alt="" @error="imageFailed = true" />
      <template v-else>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25">
          <path d="M6 3h13v18H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 0v15m-3 0h16" />
        </svg>
        <span>EPUB</span>
      </template>
    </div>
    <h2 :class="$style.title">{{ book.title }}</h2>
    <p v-if="book.author" :class="$style.author" data-testid="book-author">{{ book.author }}</p>
    <p v-if="book.metadataStatus === 'error'" :class="$style.path">{{ t('library.metadataError') }}</p>
    <p :class="$style.path" data-testid="book-path">{{ book.path }}</p>
  </article>
</template>

<style module lang="scss">
.jbrBook {
  min-width: 0;
  height: 100%;
  color: var(--text-normal);
}

.cover {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  aspect-ratio: 3 / 4;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  background: var(--background-secondary);
  color: var(--text-muted);

  svg {
    width: 44px;
    height: 44px;
  }

  span {
    font-size: 11px;
    letter-spacing: 1.5px;
  }
}

.title {
  margin: 12px 0 4px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.image {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
  border-radius: inherit;
}

.author {
  margin: 0 0 4px;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.path {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
