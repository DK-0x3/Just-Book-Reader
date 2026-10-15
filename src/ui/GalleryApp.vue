<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n({ useScope: 'global' });
</script>

<template>
  <section class="jbr-gallery">
    <div class="jbr-page">
      <header class="jbr-heading">
        <p class="jbr-eyebrow">Just Book Reader</p>
        <h1 class="jbr-title">{{ t('library.title') }}</h1>
      </header>
      <div class="jbr-empty">
        <p>{{ t('library.preparing') }}</p>
        <p class="jbr-caption">{{ t('library.nextStage') }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.jbr-gallery {
  background: var(--background-primary);
  color: var(--text-normal);
  font: 14px/1.5 var(--font-interface, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  min-height: 100%;

  &, *, *::before, *::after {
    box-sizing: border-box;
  }
}

.jbr-page {
  max-width: 1280px;
  margin: auto;
  padding: 42px 40px;

  @media (max-width: 600px) {
    padding: 28px 20px;
  }
}

.jbr-heading {
  margin-bottom: 34px;
}

.jbr-eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.jbr-title {
  margin: 0;
  font-size: 30px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--text-normal);
}

.jbr-empty {
  padding: 40px 20px;
  text-align: center;
  border: 1px solid var(--background-modifier-border);
  border-radius: 12px;

  p {
    margin: 0;
  }

  .jbr-caption {
    margin-top: 8px;
    color: var(--text-muted);
  }
}
</style>
