import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishOwnedSmoke } from './dist-install-shutdown.mjs';
test('owned exit occurs only after teardown guards and persisted receipt', () => {
  const order = [];
  finishOwnedSmoke({ shutdownResolved: true, httpListening: false, databasePidPresent: false, resources: ['Timeout'],
    diagnose: value => { order.push('diagnose'); assert.equal(value.naturalProcessExit, 'not_verified_owned_process_exit'); assert.deepEqual(value.activeResourceTypes, ['Timeout']); },
    writeReceipt: () => order.push('receipt'), exit: code => { order.push('exit'); assert.equal(code, 0); } });
  assert.deepEqual(order, ['diagnose', 'receipt', 'exit']);
});
test('failed shutdown, open listener or database pid never writes success or exits', () => {
  for (const bad of [{ shutdownResolved: false }, { httpListening: true }, { databasePidPresent: true }]) {
    const state = { shutdownResolved: true, httpListening: false, databasePidPresent: false, ...bad };
    assert.throws(() => finishOwnedSmoke({ ...state, resources: [], diagnose: () => {}, writeReceipt: () => assert.fail('receipt'), exit: () => assert.fail('exit') }), /guards/);
  }
});
test('receipt failure prevents owned success exit', () => {
  assert.throws(() => finishOwnedSmoke({ shutdownResolved: true, httpListening: false, databasePidPresent: false, resources: [], diagnose: () => {}, writeReceipt: () => { throw new Error('write failed'); }, exit: () => assert.fail('exit') }), /write failed/);
});
