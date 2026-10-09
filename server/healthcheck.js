// The images' HEALTHCHECK (Dockerfile, Dockerfile.rte-runner) : healthy when this container answers.
//   an RTE  : the port takes a connection (its API needs the token for anything else)
//   HTTPS=0 : /api/v2/version, which needs no login, answers 200 (an app node, a worker)
//   HTTPS=1 : the port takes a connection. The certificate is usually self-signed and names the
//             host, not 127.0.0.1, so checking it here would fail a healthy app - and switching
//             the check off would teach code that certificates may be ignored.
import http from "http";
import net from "net";
import { normalizeBaseUrl } from "./src/lib/baseurl.js";

const port = Number(process.env.PORT || 8000);
const fail = () => process.exit(1);
setTimeout(fail, 4500).unref();

if (process.env.HTTPS == "1" || process.env.AF_ROLE === "rte") {
  const socket = net.connect(port, "127.0.0.1", () => {
    socket.end();
    process.exit(0);
  });
  socket.on("error", fail);
} else {
  http
    .get({ host: "127.0.0.1", port, path: `${normalizeBaseUrl(process.env.BASE_URL)}/api/v2/version` },
      (res) => process.exit(res.statusCode === 200 ? 0 : 1))
    .on("error", fail);
}
