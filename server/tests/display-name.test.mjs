// The name a person is shown by in the header (src/lib/displayName.js) : read at sign-in
// from the directory entry (ldap) or the token's claims (azure ad, openid connect).
import { test, describe } from "vitest";
import assert from "node:assert/strict";
import { ldapDisplayName, claimsDisplayName } from "../src/lib/displayName.js";

describe("ldapDisplayName", () => {
  test("the displayName of the entry comes first", () => {
    assert.equal(ldapDisplayName({ displayName: "Jane Doe", givenName: "J", sn: "D", cn: "jdoe" }), "Jane Doe");
  });

  test("without one, the given name and surname together", () => {
    assert.equal(ldapDisplayName({ givenName: "Jane", sn: "Doe", cn: "jdoe" }), "Jane Doe");
    assert.equal(ldapDisplayName({ sn: "Doe" }), "Doe");
  });

  test("then the common name", () => {
    assert.equal(ldapDisplayName({ cn: "Jane Doe" }), "Jane Doe");
  });

  test("a multi-valued attribute gives its first value", () => {
    assert.equal(ldapDisplayName({ displayName: ["Jane Doe", "J. Doe"] }), "Jane Doe");
  });

  test("blank values are skipped, and nothing at all gives an empty name", () => {
    assert.equal(ldapDisplayName({ displayName: "  ", cn: "Jane Doe" }), "Jane Doe");
    assert.equal(ldapDisplayName({ uid: "jdoe" }), "");
    assert.equal(ldapDisplayName(null), "");
  });
});

describe("claimsDisplayName", () => {
  test("the name claim comes first", () => {
    assert.equal(claimsDisplayName({ name: "Jane Doe", given_name: "J", family_name: "D" }), "Jane Doe");
  });

  test("without it, the given and family names together", () => {
    assert.equal(claimsDisplayName({ given_name: "Jane", family_name: "Doe" }), "Jane Doe");
  });

  test("no name in the token gives an empty name", () => {
    assert.equal(claimsDisplayName({ preferred_username: "jdoe" }), "");
    assert.equal(claimsDisplayName(undefined), "");
  });
});
