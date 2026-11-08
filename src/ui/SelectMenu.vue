<script lang="ts">
let nextSelectId = 0;
</script>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
  type CSSProperties,
} from "vue";
import Icon from "./Icon.vue";
import type { IconName } from "./icons";

const props = defineProps<{
  modelValue: string;
  options: readonly {
    value: string;
    label: string;
  }[];
  label: string;
  icon?: IconName;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const popup = ref<HTMLUListElement>();
const open = ref(false);
const activeIndex = ref(0);
const placement = ref<CSSProperties>({ visibility: "hidden" });
const id = `jbr-select-${++nextSelectId}`;

const TYPEAHEAD_RESET_MS = 700;
const VIEWPORT_MARGIN = 8;
const POPUP_GAP = 6;
const MIN_POPUP_WIDTH = 192;
const MAX_POPUP_HEIGHT = 320;

const selectedIndex = computed(() =>
  props.options.findIndex((option) => option.value === props.modelValue),
);
const selectedLabel = computed(
  () => props.options[selectedIndex.value]?.label ?? props.modelValue,
);
let stopTracking: (() => void) | undefined;
let typeaheadText = "";
let lastTypedAt = 0;

function close(): void {
  open.value = false;
  typeaheadText = "";
}

function show(index = Math.max(0, selectedIndex.value)): void {
  if (props.disabled || !props.options.length) return;
  activeIndex.value = Math.max(0, Math.min(index, props.options.length - 1));
  placement.value = { visibility: "hidden" };
  open.value = true;
  void nextTick(() => {
    position();
    revealActive();
  });
}

function choose(index = activeIndex.value, returnFocus = true): void {
  const option = props.options[index];
  if (!option || props.disabled) return;
  close();
  if (returnFocus) trigger.value?.focus();
  if (option.value !== props.modelValue)
    emit("update:modelValue", option.value);
}

function move(index: number): void {
  activeIndex.value = Math.max(0, Math.min(index, props.options.length - 1));
  void nextTick(revealActive);
}

function revealActive(): void {
  const list = popup.value;
  const option = list?.children[activeIndex.value] as HTMLElement | undefined;
  if (!list || !option) return;
  const bounds = list.getBoundingClientRect();
  const item = option.getBoundingClientRect();
  if (item.top < bounds.top + 4) list.scrollTop -= bounds.top + 4 - item.top;
  else if (item.bottom > bounds.bottom - 4)
    list.scrollTop += item.bottom - bounds.bottom + 4;
}

function typeahead(key: string): void {
  const normalize = (text: string) =>
    text.normalize("NFC").toLocaleLowerCase().replace(/ё/g, "е");
  const now = Date.now();
  typeaheadText =
    now - lastTypedAt > TYPEAHEAD_RESET_MS ? key : typeaheadText + key;
  lastTypedAt = now;
  const repeated = [...typeaheadText].every(
    (char) => normalize(char) === normalize(key),
  );
  const needle = normalize(repeated ? key : typeaheadText);
  const start =
    typeaheadText.length > 1 && !repeated
      ? activeIndex.value
      : activeIndex.value + 1;
  for (let offset = 0; offset < props.options.length; offset++) {
    const index = (start + offset) % props.options.length;
    if (normalize(props.options[index]?.label ?? "").startsWith(needle)) {
      move(index);
      break;
    }
  }
}

function keydown(event: KeyboardEvent): void {
  if (props.disabled || event.isComposing) return;
  const wasOpen = open.value;
  if (event.key === "Tab") {
    if (wasOpen) choose(activeIndex.value, false);
    return;
  }
  if (event.key === "Escape") {
    if (wasOpen) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    return;
  }
  if (event.key === "ArrowUp" && event.altKey && wasOpen) {
    event.preventDefault();
    choose();
    return;
  }
  if (["Enter", " "].includes(event.key)) {
    event.preventDefault();
    if (wasOpen) choose();
    else show();
    return;
  }
  if (
    ["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(
      event.key,
    )
  ) {
    event.preventDefault();
    if (!wasOpen) show();
    if (event.key === "Home") move(0);
    else if (event.key === "End") move(props.options.length - 1);
    else if (wasOpen)
      move(
        activeIndex.value +
          ({ ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[
            event.key
          ] ?? 0),
      );
    return;
  }
  if (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    if (!wasOpen) show();
    typeahead(event.key);
  }
}

function position(): void {
  const button = trigger.value;
  const list = popup.value;
  const win = button?.ownerDocument.defaultView;
  if (!open.value || !button || !list || !win) return;
  const viewport = win.visualViewport;
  const leftEdge = (viewport?.offsetLeft ?? 0) + VIEWPORT_MARGIN;
  const topEdge = (viewport?.offsetTop ?? 0) + VIEWPORT_MARGIN;
  const rightEdge =
    leftEdge + (viewport?.width ?? win.innerWidth) - VIEWPORT_MARGIN * 2;
  const bottomEdge =
    topEdge + (viewport?.height ?? win.innerHeight) - VIEWPORT_MARGIN * 2;
  const bounds = button.getBoundingClientRect();
  if (bounds.bottom < topEdge || bounds.top > bottomEdge) {
    close();
    return;
  }
  const width = Math.max(
    0,
    Math.min(Math.max(bounds.width, MIN_POPUP_WIDTH), rightEdge - leftEdge),
  );
  const below = bottomEdge - bounds.bottom - POPUP_GAP;
  const above = bounds.top - topEdge - POPUP_GAP;
  const upwards = below < Math.min(list.scrollHeight + 2, 240) && above > below;
  const maxHeight = Math.max(
    0,
    Math.min(MAX_POPUP_HEIGHT, upwards ? above : below),
  );
  const height = Math.min(list.scrollHeight + 2, maxHeight);
  placement.value = {
    left: `${Math.max(leftEdge, Math.min(bounds.left, rightEdge - width))}px`,
    top: `${Math.max(topEdge, Math.min(upwards ? bounds.top - POPUP_GAP - height : bounds.bottom + POPUP_GAP, bottomEdge - height))}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    visibility: "visible",
  };
}

watch(open, (value) => {
  stopTracking?.();
  stopTracking = undefined;
  if (!value) return;
  const doc = trigger.value?.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) return;
  let frame = 0;
  const schedule = () => {
    if (!frame)
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        position();
      });
  };
  const outside = (event: Event) => {
    if (root.value && !event.composedPath().includes(root.value)) close();
  };
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("focusin", outside);
  win.addEventListener("resize", schedule);
  win.addEventListener("scroll", schedule, true);
  win.visualViewport?.addEventListener("resize", schedule);
  win.visualViewport?.addEventListener("scroll", schedule);
  const observer =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(schedule);
  if (trigger.value) observer?.observe(trigger.value);
  stopTracking = () => {
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("focusin", outside);
    win.removeEventListener("resize", schedule);
    win.removeEventListener("scroll", schedule, true);
    win.visualViewport?.removeEventListener("resize", schedule);
    win.visualViewport?.removeEventListener("scroll", schedule);
    observer?.disconnect();
    if (frame) win.cancelAnimationFrame(frame);
  };
});

watch(
  () => props.disabled,
  (value) => {
    if (value) close();
  },
);

watch(
  () => props.modelValue,
  () => {
    if (open.value) move(Math.max(0, selectedIndex.value));
  },
);

watch(
  () => props.options,
  () => {
    if (!props.options.length) close();
    else if (open.value) {
      move(Math.min(activeIndex.value, props.options.length - 1));
      void nextTick(position);
    }
  },
);

onBeforeUnmount(() => {
  stopTracking?.();
});
</script>

<template>
  <div ref="root" :class="$style.select">
    <button
      ref="trigger"
      :class="$style.trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-label="label"
      :aria-controls="`${id}-list`"
      :aria-expanded="open"
      :aria-activedescendant="open ? `${id}-${activeIndex}` : undefined"
      :disabled="disabled || !options.length"
      @click="open ? close() : show()"
      @keydown="keydown"
    >
      <Icon v-if="icon" :name="icon" />
      <span :class="$style.value">{{ selectedLabel }}</span>
      <Icon name="chevronDown" />
    </button>
    <ul
      v-if="open"
      :id="`${id}-list`"
      ref="popup"
      :class="$style.popup"
      :style="placement"
      role="listbox"
      :aria-label="label"
    >
      <li
        v-for="(option, index) in options"
        :id="`${id}-${index}`"
        :key="option.value"
        :class="[$style.option, { [$style.active]: activeIndex === index }]"
        role="option"
        :aria-selected="activeIndex === index"
        @pointermove="activeIndex = index"
        @pointerdown.prevent
        @click="choose(index)"
      >
        <span>{{ option.label }}</span
        ><Icon v-if="option.value === modelValue" name="check" />
      </li>
    </ul>
  </div>
</template>

<style module lang="scss">
@use "./controls";

.select {
  min-width: 0;
  max-width: 100%;
}

.trigger {
  @include controls.control;
  width: 100%;
  justify-content: flex-start;
  text-align: start;

  &[aria-expanded="true"] {
    border-color: var(--jbr-accent);
    background: var(--jbr-selected);
  }
}

.value {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.popup {
  box-sizing: border-box;
  position: fixed;
  z-index: 1000;
  overflow: auto;
  overscroll-behavior: contain;
  margin: 0;
  padding: 5px;
  list-style: none;
  border: 1px solid var(--jbr-border);
  border-radius: 11px;
  background: var(--jbr-surface);
  color: var(--jbr-text);
  box-shadow: var(--jbr-popup-shadow);
  font: inherit;
  line-height: 1.4;
}

.option {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 42px;
  padding: 9px 10px;
  border-radius: 6px;
  cursor: pointer;
  overflow-wrap: anywhere;

  > span {
    min-width: 0;
  }
}

.active {
  background: var(--jbr-selected);
  outline: 1px solid var(--jbr-accent);
  outline-offset: -1px;
}
</style>
