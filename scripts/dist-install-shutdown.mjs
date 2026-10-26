/** The smoke owns its Node process; startServer().shutdown() deliberately does
 * not. Verify application teardown, record public resource types, then exit.
 * Remaining resource types are evidence, not a claim of natural quiescence. */
export function finishOwnedSmoke({ shutdownResolved, httpListening, databasePidPresent, resources, diagnose, writeReceipt, exit }) {
  const teardown = { shutdownResolved, httpListening, databasePidPresent, activeResourceTypes: [...resources], naturalProcessExit: 'not_verified_owned_process_exit' };
  diagnose(teardown);
  if (!shutdownResolved || httpListening || databasePidPresent) throw new Error('Installed smoke shutdown guards did not pass');
  writeReceipt(teardown);
  exit(0);
}
