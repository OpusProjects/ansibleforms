/******************************************************************/
/*                                                                */
/*  What the database user may do beyond the AnsibleForms         */
/*  schema. The app needs `ALL PRIVILEGES ON AnsibleForms.*` and  */
/*  nothing else : creating its schema, patching it, the backups, */
/*  and ending a dead worker's session (KILL works on the same    */
/*  user's own sessions without any server-wide right). A user    */
/*  with rights on every database - root, as the examples used -  */
/*  turns any hole in the app into a hole in the whole server.    */
/*                                                                */
/******************************************************************/
import mysql from "../models/db.model.js";

/**
 * The server-wide privileges in a list of GRANT statements : those granted `ON *.*`, other
 * than USAGE (the right to connect, which every user has).
 *
 * Args:
 *   grants (string[]): the lines of SHOW GRANTS.
 *
 * Returns:
 *   string[]: the server-wide privileges, as named in the grants ; empty when none.
 */
export function serverWidePrivileges(grants) {
  const found = [];
  for (const line of grants || []) {
    const m = /^GRANT\s+(.+?)\s+ON\s+\*\.\*\s+TO\s/i.exec(String(line).trim());
    if (!m) continue;
    for (const p of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!/^USAGE$/i.test(p)) found.push(p.toUpperCase());
    }
  }
  return found;
}

/**
 * The server-wide privileges of the user the app connects with.
 *
 * Returns:
 *   Promise<{user: string, privileges: string[]}>: the user and its server-wide privileges.
 */
export async function databaseUserPrivileges() {
  const who = await mysql.do("SELECT CURRENT_USER() AS u");
  const rows = await mysql.do("SHOW GRANTS FOR CURRENT_USER()");
  const grants = (rows || []).map((r) => Object.values(r)[0]);
  return { user: who?.[0]?.u || "unknown", privileges: serverWidePrivileges(grants) };
}

export default { serverWidePrivileges, databaseUserPrivileges };
