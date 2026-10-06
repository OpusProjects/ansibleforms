// The name a person is shown by (the header's user menu), next to the username they sign in
// with. Local accounts have none : they are shown by their username.
//
// It is read at sign-in from what the identity source already returns, so no setting is
// needed : the directory entry for ldap, the token's claims for azure ad and openid connect.
// It travels in the user object of the tokens (a refresh copies it along with the rest).

// an ldap attribute can come back as a string or, when multi-valued, as an array of them
function firstValue(value) {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" ? v.trim() : "";
}

// the name of a directory entry : its displayName (active directory, most openldap
// directories), else the given name and surname together, else its common name
export function ldapDisplayName(entry) {
  if (!entry || typeof entry !== "object") return "";
  const displayName = firstValue(entry.displayName);
  if (displayName) return displayName;
  const fullName = [firstValue(entry.givenName), firstValue(entry.sn)].filter(Boolean).join(" ");
  if (fullName) return fullName;
  return firstValue(entry.cn);
}

// the name in an azure ad or openid connect token : the standard `name` claim, else the
// given and family names together
export function claimsDisplayName(claims) {
  if (!claims || typeof claims !== "object") return "";
  const name = firstValue(claims.name);
  if (name) return name;
  return [firstValue(claims.given_name), firstValue(claims.family_name)].filter(Boolean).join(" ");
}
