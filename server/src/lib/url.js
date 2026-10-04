// Url and path helpers. Loops rather than /\/+$/-style regexes : those retry from every
// slash of a long run of them, which is polynomial on a crafted value (CodeQL
// js/polynomial-redos), and a url or path often comes from a user.

/** "https://host:8200///" -> "https://host:8200" */
export function stripTrailingSlashes(value) {
  const s = String(value ?? "");
  let end = s.length;
  while (end > 0 && s[end - 1] === "/") end--;
  return s.slice(0, end);
}

/** "///secret/app" -> "secret/app" */
export function stripLeadingSlashes(value) {
  const s = String(value ?? "");
  let start = 0;
  while (start < s.length && s[start] === "/") start++;
  return s.slice(start);
}

/** joinUrl("https://h/", "/v1/x") -> "https://h/v1/x" : exactly one slash between the two */
export function joinUrl(base, path) {
  const tail = stripLeadingSlashes(path);
  return tail ? `${stripTrailingSlashes(base)}/${tail}` : stripTrailingSlashes(base);
}

export default { stripTrailingSlashes, stripLeadingSlashes, joinUrl };
