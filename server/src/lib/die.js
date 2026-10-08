// Refusing to start, or stopping, is only useful if the REASON survives. winston's file
// transport is asynchronous, so process.exit() truncates whatever it has not written yet - which
// loses precisely the one line that explains a crash-looping container. stderr is what
// `kubectl logs` and `docker logs` show, so the reason goes there too, and the short wait gives
// the file transport a chance to catch up.
import logger from "./logger.js";

export async function die(message) {
  logger.error(message);
  console.error(message);
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.exit(1);
}
