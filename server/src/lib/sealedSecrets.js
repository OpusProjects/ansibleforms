/******************************************************************/
/*                                                                */
/*  A job's secrets, sealed for the RTE that runs it.             */
/*                                                                */
/*  The app resolves a playbook job's credentials (the stored     */
/*  ones and those read from a secret store) and hands them to    */
/*  the RTE with the job : the RTE never reads the credentials    */
/*  table nor a secret store, and needs no ENCRYPTION_SECRET to   */
/*  run a job. The bundle is sealed with AES-256-GCM, under a key */
/*  derived from the RTE's token and the job id : it opens for    */
/*  that RTE and that job only, and a changed byte is refused     */
/*  rather than read - also over plain http inside a cluster.     */
/*                                                                */
/******************************************************************/
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

const VERSION = 1;
const SALT = "ansibleforms-rte-job-secrets";

/**
 * The key and the additional data of one job's bundle.
 *
 * Args:
 *   token (string): the RTE's token (RTE_TOKEN), known to the app and the RTE.
 *   jobId (number|string): the job.
 *
 * Returns:
 *   {key: Buffer, aad: Buffer}: the AES-256 key and the data the tag also covers.
 */
function keyFor(token, jobId) {
  if (!token) throw new Error("no RTE token to seal the job's secrets with");
  const info = `job:${jobId}`;
  return { key: Buffer.from(hkdfSync("sha256", String(token), SALT, info, 32)), aad: Buffer.from(info) };
}

/**
 * Seals a job's secrets for the RTE.
 *
 * Args:
 *   secrets (object): the secrets, any JSON value.
 *   token (string): the RTE's token.
 *   jobId (number|string): the job.
 *
 * Returns:
 *   object: { v, iv, tag, data }, base64 strings.
 */
export function sealJobSecrets(secrets, token, jobId) {
  const { key, aad } = keyFor(token, jobId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(JSON.stringify(secrets ?? null), "utf8"), cipher.final()]);
  return { v: VERSION, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

/**
 * Opens a job's sealed secrets.
 *
 * Args:
 *   sealed (object): what sealJobSecrets returned.
 *   token (string): the RTE's token.
 *   jobId (number|string): the job.
 *
 * Returns:
 *   any: the secrets.
 *
 * Raises:
 *   Error: no bundle, an unknown version, or one that does not open for this token and job.
 */
export function openJobSecrets(sealed, token, jobId) {
  if (!sealed || typeof sealed !== "object") throw new Error("the job came without its sealed secrets");
  if (sealed.v !== VERSION) throw new Error(`the job's secrets are sealed with version ${sealed.v}, this RTE reads version ${VERSION}`);
  const { key, aad } = keyFor(token, jobId);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(String(sealed.iv), "base64"));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(String(sealed.tag), "base64"));
    const text = Buffer.concat([decipher.update(Buffer.from(String(sealed.data), "base64")), decipher.final()]).toString("utf8");
    return JSON.parse(text);
  } catch (err) {
    throw new Error("the job's sealed secrets do not open with this RTE's token for this job", { cause: err });
  }
}

export default { sealJobSecrets, openJobSecrets };
