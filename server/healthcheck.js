// The image's HEALTHCHECK (see Dockerfile) : healthy when /api/v2/version, which needs no login,
// answers 200 on this container. The certificate is not checked : HTTPS=1 serves the
// app's own, usually self-signed, one.
import http from "http";
import https from "https";
import { normalizeBaseUrl } from "./src/lib/baseurl.js";

const client = process.env.HTTPS == "1" ? https : http;
const request = client.get(
  {
    host: "127.0.0.1",
    port: process.env.PORT || 8000,
    path: `${normalizeBaseUrl(process.env.BASE_URL)}/api/v2/version`,
    rejectUnauthorized: false,
    timeout: 4000,
  },
  (res) => process.exit(res.statusCode === 200 ? 0 : 1),
);
request.on("timeout", () => request.destroy());
request.on("error", () => process.exit(1));
