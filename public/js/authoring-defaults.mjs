// Bilingual defaults the authoring studio writes into newly placed entities. These are
// content values for the author's draft (both locales at once), not fixed UI text — which is
// why they live here instead of inside a view, where the bilingual UI contract test scans for
// untranslated interface strings.
export const ENTITY_DEFAULTS = {
  door: { 'zh-CN': '木门', en: 'Wooden Door' },
  campfire: { 'zh-CN': '营火', en: 'Campfire' }
};
