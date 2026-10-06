import express from "express";
import Settings from "../../models/settings.model.js";
import logger from "../../lib/logger.js";
import logConfig from "../../../config/log.config.js";
import appConfig from "../../../config/app.config.js";
import ChatSettings from "../../models/chatSettings.model.js";
const router = express.Router();

// /config is an unauthenticated bootstrap endpoint the SPA hits on every load,
// so cache the resolved defaults for a short TTL to avoid a DB round-trip
// per request. A change still propagates within CACHE_TTL_MS.
const CACHE_TTL_MS = 60 * 1000;
let defaultsCache = { value: undefined, fetchedAt: 0 };

async function resolveDefaults() {
  if (defaultsCache.value !== undefined && (Date.now() - defaultsCache.fetchedAt) < CACHE_TTL_MS) {
    return defaultsCache.value;
  }
  // ENVIRONMENT first, then the database, then the built-in default - the same order the
  // rest of the app uses. An explicitly set DEFAULT_LANGUAGE therefore wins over the
  // default_language column, and the settings page greys that field out to say so.
  // (Before 6.3.0 the database value won and the variable was only a fallback.)
  const languageFromEnv = process.env.DEFAULT_LANGUAGE || null;
  let result = { language: languageFromEnv || "en", theme: null, color: null };
  try {
    // language, theme and theme color all live on the same single settings row, so
    // they are read in ONE query : this endpoint blocks the SPA from rendering even
    // the login page, so a MySQL outage must cost one connectTimeout, not one per
    // setting.
    const defaults = await Settings.findAppDefaults();
    // only when the environment did not set one
    if (!languageFromEnv && defaults.language) {
      result.language = defaults.language;
    }
    result.theme = defaults.theme;
    result.color = defaults.color;
  } catch (e) {
    logger.debug("Could not read the defaults from database, using env var fallback")
  }
  defaultsCache = { value: result, fetchedAt: Date.now() };
  return result;
}

// Whether the chat button may show : ENABLE_CHAT, and a provider with a key and a model.
// Only a boolean - this route is unauthenticated, the provider details stay behind the
// settings page.
async function chatEnabled() {
  if (!appConfig.enableChat) return false;
  return ChatSettings.configuredCached();
}

router.get("/config", async (req, res) => {
  const defaults = await resolveDefaults();
  res.json({
    navHomeLabel: process.env.NAV_HOME_LABEL || "Forms",
    navHomeIcon: process.env.NAV_HOME_ICON || "rectangle-list",
    defaultLanguage: defaults.language,
    defaultTheme: defaults.theme,
    defaultThemeColor: defaults.color,
    // timezone the server logs and schedules in : the client renders cron next-run
    // previews in it, so a cron shown in the UI matches when the job really runs
    logTz: logConfig.tz,
    chatEnabled: await chatEnabled(),
  });
});

export default router;
