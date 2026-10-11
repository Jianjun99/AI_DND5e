// One presentation contract for browser and server; no numeric rule copies.
const contract = import('../public/js/localization/locale.mjs');

function localeMiddleware(req, res, next) {
  contract.then(({ requestLocale }) => {
    // Request-local only: concurrent players cannot overwrite a global setting.
    res.locals.locale = requestLocale(req.get('X-Game-Locale'), req.get('Accept-Language'));
    next();
  }).catch(next);
}

function localeInfo(req, res) {
  contract.then(({ SUPPORTED_LOCALES, DEFAULT_LOCALE }) => {
    res.json({ locale: res.locals.locale, supportedLocales: SUPPORTED_LOCALES, defaultLocale: DEFAULT_LOCALE });
  }).catch(error => res.status(500).json({ error: error.message }));
}

module.exports = { localeMiddleware, localeInfo };
