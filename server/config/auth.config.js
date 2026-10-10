import crypto from 'crypto';

let jwtSecret = process.env.ACCESS_TOKEN_SECRET;
let jwtSecretIsGenerated = false;

if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(64).toString('hex');
  jwtSecretIsGenerated = true;
  console.warn('[SECURITY WARNING] ACCESS_TOKEN_SECRET is not set. A random secret has been generated for this process. Tokens will NOT survive a restart. Set ACCESS_TOKEN_SECRET in your environment for stable token signing.');
}

export default {
  secret: jwtSecret,
  secretIsGenerated: jwtSecretIsGenerated,
  jwtExpiration: process.env.ACCESS_TOKEN_EXPIRATION || "30m",
  jwtRefreshExpiration: process.env.ACCESS_TOKEN_REFRESH_EXPIRATION || "24h",
  jwtIssuer: process.env.ACCESS_TOKEN_ISSUER || "ansibleforms",
  // an api token (a login with ?expiryDays=, for a role with extendedTokenExpiration) lives this
  // many days at most ; a longer request is cut to it
  apiTokenMaxDays: Math.max(1, parseInt(process.env.API_TOKEN_MAX_DAYS ?? 90, 10) || 90),
  azureGraphUrl: process.env.AZURE_GRAPH_URI || "https://graph.microsoft.com",
  ldapErrorRegex:".*, data ([^,]*),.*",
  ldapErrors:{
    "52e":"Wrong password",
    "525":"User not found",
    "530":"Not permitted to logon at this time",
    "532":"Password expired",
    "533":"Account disabled",
    "701":"Account expired",
    "773":"User must reset password",
    "775":"Account locked"
  }
};
