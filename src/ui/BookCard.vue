<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Book } from '../domain/library';
import Icon from './Icon.vue';

const METADATA_PRELOAD_MARGIN = '180px';

const props = defineProps<{
  book: Book;
}>();
const emit = defineEmits<{
  visibility: [path: string, visible: boolean];
  select: [path: string, trigger: HTMLButtonElement];
  retry: [path: string];
}>();
const { t } = useI18n({ useScope: 'global' });

const card = ref<HTMLElement>();
const detailsButton = ref<HTMLButtonElement>();
const imageFailed = ref(false);
let observer: IntersectionObserver | undefined;

function retry(): void {
  emit('retry', props.book.path);
  detailsButton.value?.focus();
}

function select(event: MouseEvent): void {
  emit('select', props.book.path, event.currentTarget as HTMLButtonElement);
}

watch(() => props.book.coverUrl, () => {
  imageFailed.value = false;
});

onMounted(() => {
  if (!card.value) return;
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) emit('visibility', props.book.path, entry.isIntersecting);
  }, { rootMargin: METADATA_PRELOAD_MARGIN });
  observer.observe(card.value);
});

onUnmounted(() => {
  observer?.disconnect();
  emit('visibility', props.book.path, false);
});
</script>

<template>
  <article
    ref="card"
    :class="$style.jbrBook"
    data-testid="book-card"
    :aria-busy="book.metadataStatus === 'loading'"
  >
    <button
      ref="detailsButton"
      :class="$style.detailsButton"
      type="button"
      :aria-label="t('library.openDetails', { title: book.title })"
      @click="select"
    />
    <div :class="$style.cover" aria-hidden="true">
      <img
        v-if="book.coverUrl && !imageFailed"
        :class="$style.image"
        :src="book.coverUrl"
        alt=""
        @error="imageFailed = true"
      />
      <template v-else>
        <Icon name="book" />
        <span>EPUB</span>
      </template>
    </div>
    <h2 :class="$style.title">{{ book.title }}</h2>
    <p
      v-if="book.author"
      :class="$style.author"
      data-testid="book-author"
    >{{ book.author }}</p>
    <div v-if="book.metadataStatus === 'error'" :class="$style.bookError">
      <p :class="$style.path" role="alert">{{ t(book.metadataError === 'too-large' ? 'library.tooLarge' : 'library.metadataError') }}</p>
      <button
        :class="$style.retry"
        type="button"
        @click="retry"
      >{{ t('library.retry') }}</button>
    </div>
    <p :class="$style.path" data-testid="book-path">{{ book.path }}</p>
  </article>
</template>

<style module lang="scss">
@use './controls';

.jbrBook {
  position: relative;
  min-width: 0;
  height: 100%;
  color: var(--jbr-text);
}

.jbrBook .detailsButton {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 8px;
  box-shadow: none;
  background: transparent;
  cursor: pointer;

  &:hover, &:active {
    background: transparent;
    box-shadow: none;
  }

  &:focus-visible {
    outline: 2px solid var(--jbr-focus);
    outline-offset: 5px;
  }
}

.bookError {
  margin: 6px 0;
}

.retry {
  @include controls.control;
  position: relative;
  z-index: 2;
  margin-top: 4px;
  min-height: 36px;
  padding: 4px 8px;
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
  border: 1px solid var(--jbr-border);
  border-radius: 8px;
  background: var(--jbr-surface);
  color: var(--jbr-muted);
  transition: transform var(--jbr-duration), box-shadow var(--jbr-duration);

  svg {
    width: 44px;
    height: 44px;
  }

  span {
    font-size: 11px;
    letter-spacing: 1.5px;
  }
}

@media (hover: hover) and (pointer: fine) {
  .jbrBook:hover .cover {
    transform: var(--jbr-card-transform);
    box-shadow: var(--jbr-card-shadow);
    border-color: var(--jbr-accent);
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
  color: var(--jbr-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
