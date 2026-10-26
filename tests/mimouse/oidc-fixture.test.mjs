import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { startOidcFixture, FIXTURE_CLIENT_SECRET } from './oidc-fixture.mjs';
async function authorize(fixture, verifier, subject = 'owner') {
  const url = new URL('/authorize', fixture.issuer); for (const [key, value] of Object.entries({ client_id: fixture.clientId, redirect_uri: fixture.redirectUri, response_type: 'code', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), nonce: 'fixture-nonce', state: 'fixture-state' })) url.searchParams.set(key, value);
  const page = await fetch(url); assert.equal(page.status, 200); assert.ok(page.headers.get("content-security-policy").includes("form-action 'self' http://127.0.0.1:3101")); const request = /name="request" value="([a-f0-9-]+)"/.exec(await page.text())?.[1]; assert.ok(request);
  const response = await fetch(`${fixture.issuer}/authorize`, { method: 'POST', headers: { origin: fixture.issuer }, body: new URLSearchParams({ request, subject }), redirect: 'manual' });
  assert.equal(response.status, 302); const callback = new URL(response.headers.get('location')); assert.equal(callback.searchParams.get('state'), 'fixture-state'); return callback.searchParams.get('code');
}
const redeem = (fixture, code, verifier) => fetch(`${fixture.issuer}/token`, { method: 'POST', body: new URLSearchParams({ client_id: fixture.clientId, client_secret: FIXTURE_CLIENT_SECRET, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: fixture.redirectUri }) });
test('loopback IdP validates PKCE and creates a signed, one-use nonce-bound identity', async () => {
  const fixture = await startOidcFixture({ port: 0 });
  try {
    const verifier = 'v'.repeat(64), code = await authorize(fixture, verifier);
    const exchange = await redeem(fixture, code, verifier); assert.equal(exchange.status, 200); const result = await exchange.json();
    const [header, payload, signature] = result.id_token.split('.'); const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(claims.iss, fixture.issuer); assert.equal(claims.aud, fixture.clientId); assert.equal(claims.nonce, 'fixture-nonce'); assert.equal(claims.email, 'owner@paperclip-fixture.invalid');
    const jwks = await (await fetch(`${fixture.issuer}/jwks`)).json(); assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey({ key: jwks.keys[0], format: 'jwk' }), Buffer.from(signature, 'base64url')), true);
    assert.equal((await redeem(fixture, code, verifier)).status, 400);
  } finally { await fixture.close(); }
});
test('wrong verifier, foreign app origins and foreign redirects are rejected', async () => {
  await assert.rejects(startOidcFixture({ appOrigin: 'https://example.com' }), /loopback/);
  const fixture = await startOidcFixture({ port: 0 });
  try {
    const code = await authorize(fixture, 'x'.repeat(64), 'outsider'); assert.equal((await redeem(fixture, code, 'wrong')).status, 400); assert.equal((await redeem(fixture, code, 'x'.repeat(64))).status, 400);
    assert.equal((await fetch(`${fixture.issuer}/authorize?redirect_uri=https://example.com`)).status, 400);
    assert.equal((await fetch(`${fixture.issuer}/logout?post_logout_redirect_uri=https://example.com`, { redirect: 'manual' })).status, 400);
    assert.deepEqual(await (await fetch(`${fixture.issuer}/__fixture/status`)).json(), { kind: 'loopback-only', logoutRedirects: 0 });
    const logout = await fetch(`${fixture.issuer}/logout?post_logout_redirect_uri=${encodeURIComponent('http://127.0.0.1:3101/auth')}`, { redirect: 'manual' }); assert.equal(logout.status, 302);
    assert.deepEqual(await (await fetch(`${fixture.issuer}/__fixture/status`)).json(), { kind: 'loopback-only', logoutRedirects: 1 });
  } finally { await fixture.close(); }
});
