<script setup lang="ts">
import type { Book } from '../domain/library';

defineProps<{ book: Book }>();
</script>

<template>
  <article :class="$style.jbrBook" data-testid="book-card">
    <div :class="$style.cover" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25">
        <path d="M6 3h13v18H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 0v15m-3 0h16" />
      </svg>
      <span>EPUB</span>
    </div>
    <h2 :class="$style.title">{{ book.title }}</h2>
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

.path {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
