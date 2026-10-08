// What an app and an RTE must agree on to work together, as one number.
//
// The RTE shares the app's code but runs on its own release cycle : an RTE that was tested and
// approved keeps running across app releases as long as the contract is the same. Bump it -
// and say so in the release notes, "RTEs must be updated" - only when a change would break an
// RTE of the previous contract :
//   - the RTE API (/rte/v1 : its calls, what they take and answer)
//   - what the RTE reads and writes in the database : jobs (extravars, credentials, status,
//     abort_requested, host, job_log), job_output, credentials, secret_stores, and its
//     heartbeat in nodes
//   - how credentials are encrypted (lib/crypto.js) or resolved (secrets/)
// Anything else - a new app feature, a new column the RTE does not touch - leaves it alone.
export const RTE_CONTRACT = 1;
