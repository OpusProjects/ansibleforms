// The help texts for where LDAP and Entra ID groups come from, checked against what the
// server actually does - in every language, since an admin reads the hint in their own.
//
// LDAP : the group search of ldap-authentication (_attachGroups) only runs when BOTH the
// groups search base and the group class are set, and it stores what it finds in the
// attribute `groups` of the user entry. The server then reads the groups from whatever
// attribute "Groups Attribute" names (User.getGroups), so the search result is only used
// when that attribute is `groups`. The hint used to say "leave empty to use the main search
// base", which no code does : an empty groups search base means no group search at all.
//
// Entra ID : the login reads the groups from Microsoft Graph (lib/azureGraph.js,
// /me/transitiveMemberOf, by display name) with the access token, and the role mapping
// sees them as azuread/<name>. The help used to list "Required Group Claims", sending
// admins to configure a groups claim in the token that the login never reads.
import { describe, it, expect } from 'vitest';

const LANGS = ['en', 'de', 'fr', 'it', 'es', 'nl'];

const locales = {};
for (const lang of LANGS) {
  locales[lang] = (await import(`../src/locales/${lang}.js`)).default;
}

describe.each(LANGS)('the auth group hints (%s)', (lang) => {
  const ldap = locales[lang].settings.ldap;
  const oauth2 = locales[lang].admin.oauth2;

  it('name the attribute the ldap group search fills', () => {
    // `groups` is the literal attribute name, not translated
    expect(ldap.groupsSearchBaseDesc).toMatch(/\bgroups\b/);
    expect(ldap.groupsAttributeDesc).toMatch(/\bgroups\b/);
  });

  it('say Entra ID groups come from Microsoft Graph, mapped as azuread/', () => {
    expect(oauth2.requiredGroupClaims).toBeUndefined();
    expect(oauth2.groupsFromGraph).toMatch(/Microsoft Graph/);
    expect(oauth2.groupsRoleMapping).toMatch(/azuread\//);
  });
});
