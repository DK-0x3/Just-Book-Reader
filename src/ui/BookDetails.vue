<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { Book } from "../domain/library";
import { isOutsideDialog } from "./dialog";

const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = BYTES_PER_KIB ** 2;

const props = defineProps<{ book: Book }>();
const emit = defineEmits<{ close: []; retry: [path: string] }>();
const { t, locale } = useI18n({ useScope: "global" });
const dialog = ref<HTMLDialogElement>();
const closeButton = ref<HTMLButtonElement>();
let startedOutside = false;

const filename = computed(
    () => props.book.path.split("/").pop() || props.book.name,
);
const size = computed(() => {
    const bytes = props.book.size;
    const divisor =
        bytes >= BYTES_PER_MIB
            ? BYTES_PER_MIB
            : bytes >= BYTES_PER_KIB
              ? BYTES_PER_KIB
              : 1;
    const unit =
        divisor === BYTES_PER_MIB
            ? "mib"
            : divisor === BYTES_PER_KIB
              ? "kib"
              : "bytes";
    return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(bytes / divisor)} ${t(`library.${unit}`)}`;
});

function close(): void {
    dialog.value?.close();
}

function retry(): void {
    emit("retry", props.book.path);
    closeButton.value?.focus();
}

function keepFocus(event: KeyboardEvent): void {
    if (event.key !== "Tab" || !dialog.value) return;
    const buttons = dialog.value.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
    );
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (!first || !last) return;
    const active = dialog.value.ownerDocument.activeElement;
    if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
}

function outsideClick(event: MouseEvent): void {
    if (startedOutside && isOutsideDialog(event, dialog.value)) close();
    startedOutside = false;
}

onMounted(() => {
    dialog.value?.showModal();
});
onBeforeUnmount(close);
</script>

<template>
    <dialog
        ref="dialog"
        :class="$style.details"
        :aria-label="t('library.details')"
        @cancel.prevent="close"
        @close="emit('close')"
        @keydown="keepFocus"
        @pointerdown="startedOutside = isOutsideDialog($event, dialog)"
        @pointercancel="startedOutside = false"
        @click="outsideClick"
    >
        <header :class="$style.heading">
            <h2>{{ t("library.details") }}</h2>
            <button
                ref="closeButton"
                :class="$style.control"
                type="button"
                autofocus
                @click="close"
            >
                {{ t("library.close") }}
            </button>
        </header>
        <h3 :class="$style.title">{{ book.title }}</h3>
        <p :class="$style.author">
            {{ book.author || t("library.unknownAuthor") }}
        </p>
        <dl :class="$style.properties">
            <dt>{{ t("library.file") }}</dt>
            <dd>{{ filename }}</dd>
            <dt>{{ t("library.path") }}</dt>
            <dd>{{ book.path }}</dd>
            <dt>{{ t("library.size") }}</dt>
            <dd>{{ size }}</dd>
            <dt>{{ t("library.format") }}</dt>
            <dd>EPUB</dd>
        </dl>
        <p v-if="book.metadataStatus === 'loading'" role="status">
            {{ t("library.loadingMetadata") }}
        </p>
        <div v-if="book.metadataStatus === 'error'" :class="$style.error">
            <p role="alert">
                {{
                    t(
                        book.metadataError === "too-large"
                            ? "library.tooLarge"
                            : "library.metadataError",
                    )
                }}
            </p>
            <button :class="$style.control" type="button" @click="retry">
                {{ t("library.retry") }}
            </button>
        </div>
    </dialog>
</template>

<style module lang="scss">
.details {
    box-sizing: border-box;
    width: min(520px, calc(100% - 32px));
    max-width: calc(100% - 32px);
    max-height: calc(100% - 32px);
    margin: auto;
    padding: 24px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    background: var(--background-primary);
    color: var(--text-normal);
    font: inherit;
    overflow: auto;
    overflow-wrap: anywhere;

    &::backdrop {
        background: rgb(0 0 0 / 45%);
    }
}
.heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 24px;

    h2 {
        margin: 0;
        font-size: 20px;
    }
}
.title {
    margin: 0 0 8px;
    font-size: 18px;
}
.author {
    margin: 0 0 24px;
    color: var(--text-muted);
}
.properties {
    display: grid;
    grid-template-columns: minmax(0, 100px) minmax(0, 1fr);
    gap: 12px;
    margin: 0;

    dt {
        color: var(--text-muted);
    }
    dd {
        margin: 0;
        min-width: 0;
    }

    @media (max-width: 375px) {
        grid-template-columns: minmax(0, 1fr);
        gap: 6px;
        dd {
            margin-bottom: 12px;
        }
    }
}
.control {
    font: inherit;
    min-height: 40px;
    max-width: 100%;
    padding: 8px 12px;
    white-space: normal;
    color: var(--text-normal);
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    cursor: pointer;

    &:focus-visible {
        outline: 2px solid var(--text-normal);
        outline-offset: 2px;
    }
}
.error {
    margin-top: 24px;
}
</style>
