import { createApp, h, ref } from 'vue';
import GalleryApp from '../src/ui/GalleryApp.vue';
import { createLocalization, resolveLocale } from '../src/i18n';
import './styles.scss';

const localization = createLocalization('ru');
const { locale, t } = localization.global;
const visible = ref(true);
const app = createApp({
  setup() {
    return () => h('div', { class: 'dev-shell' }, [
      h('div', { class: 'dev-toolbar' }, [
        h('span', t('development.title')),
        h('label', [
          `${t('development.language')} `,
          h('select', {
            value: locale.value,
            onChange: (event: Event) => {
              locale.value = resolveLocale((event.target as HTMLSelectElement).value);
            },
          }, [h('option', { value: 'ru' }, 'Русский'), h('option', { value: 'en' }, 'English')]),
        ]),
        h('button', { onClick: () => { visible.value = !visible.value; } },
          t(visible.value ? 'development.closeView' : 'development.openView')),
      ]),
      visible.value ? h(GalleryApp) : null,
    ]);
  },
});
app.use(localization);
app.mount('#app');

let disposed = false;
function dispose(): void {
  if (disposed) return;
  disposed = true;
  window.removeEventListener('pagehide', dispose);
  app.unmount();
}
window.addEventListener('pagehide', dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
