/** Local-only test identity provider. Never registered in the production app.
 * It exercises the real browser/OIDC protocol without contacting Casdoor.
 * All identities, client credentials and signing keys are disposable fixtures.
 */
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const CLIENT = 'paperclip-browser-fixture';
export const FIXTURE_CLIENT_SECRET = 'local-fixture-only-not-a-real-client-secret';
const identities = {
  owner: { sub: 'fixture-owner', email: 'owner@paperclip-fixture.invalid', name: 'Fixture Owner' },
  member: { sub: 'fixture-member', email: 'member@paperclip-fixture.invalid', name: 'Fixture Member' },
  outsider: { sub: 'fixture-outsider', email: 'outsider@paperclip-fixture.invalid', name: 'Fixture Outsider' },
  legacy: { sub: 'fixture-legacy', email: 'legacy@paperclip-fixture.invalid', name: 'Fixture Legacy' },
};
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
export async function startOidcFixture({ port = 3102, appOrigin = 'http://127.0.0.1:3101' } = {}) {
  const app = new URL(appOrigin);
  if (app.protocol !== 'http:' || app.hostname !== '127.0.0.1' || app.username || app.password || app.pathname !== '/' || app.search || app.hash) throw Error('Fixture app origin must be plain loopback');
  const redirectUri = `${app.origin}/api/auth/callback/casdoor`;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pending = new Map(), codes = new Map(); let issuer = '';
  const stats = { logoutRedirects: 0 };
  const response = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  async function readBody(req) { let bytes = 0; const chunks = []; for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) throw Error('Request too large'); chunks.push(chunk); } return new URLSearchParams(Buffer.concat(chunks).toString('utf8')); }
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(issuer).host) return response(res, 400, { error: 'fixture_host_mismatch' });
      const url = new URL(req.url, issuer);
      for (const map of [pending, codes]) for (const [key, value] of map) if (value.expires < Date.now()) map.delete(key);
      if (req.method === 'GET' && url.pathname === '/__fixture/status') return response(res, 200, { kind: 'loopback-only', ...stats });
      if (req.method === 'GET' && url.pathname === '/discovery') return response(res, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, end_session_endpoint: `${issuer}/logout`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'] });
      if (req.method === 'GET' && url.pathname === '/jwks') return response(res, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture-rsa', alg: 'RS256', use: 'sig' }] });
      if (req.method === 'GET' && url.pathname === '/authorize') {
        const query = url.searchParams;
        if (query.get('client_id') !== CLIENT || query.get('redirect_uri') !== redirectUri || query.get('response_type') !== 'code' || query.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(query.get('code_challenge') ?? '') || !query.get('state') || !query.get('nonce')) return response(res, 400, { error: 'invalid_authorization_request' });
        if (pending.size >= 1000 || codes.size >= 1000) return response(res, 429, { error: 'fixture_capacity_reached' });
        const id = randomUUID(); pending.set(id, { state: query.get('state'), nonce: query.get('nonce'), challenge: query.get('code_challenge'), expires: Date.now() + 300000 });
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': `default-src 'none'; form-action 'self' ${app.origin}; base-uri 'none'; frame-ancestors 'none'` });
        res.end(`<!doctype html><html lang="en"><title>Local OIDC fixture</title><body><h1>Local test identity provider</h1><p>Disposable identities only. This is not your Casdoor tenant.</p><form action="/authorize" method="post"><input type="hidden" name="request" value="${id}"><label for="subject">Test identity</label><select id="subject" name="subject">${Object.keys(identities).map(key => `<option value="${key}">${identities[key].name}</option>`).join('')}</select><button type="submit">Continue with test identity</button></form></body></html>`); return;
      }
      if (req.method === 'POST' && url.pathname === '/authorize') {
        if (req.headers.origin && req.headers.origin !== issuer) return response(res, 403, { error: 'fixture_origin_mismatch' });
        const body = await readBody(req), id = body.get('request'), authorization = pending.get(id); pending.delete(id);
        const subject = body.get('subject'); if (!authorization || !Object.hasOwn(identities, subject)) return response(res, 400, { error: 'invalid_fixture_identity' });
        const code = randomUUID(); codes.set(code, { ...authorization, ...identities[subject] });
        const target = new URL(redirectUri); target.searchParams.set('code', code); target.searchParams.set('state', authorization.state);
        res.writeHead(302, { location: target.href, 'cache-control': 'no-store' }); res.end(); return;
      }
      if (req.method === 'POST' && url.pathname === '/token') {
        const body = await readBody(req);
        const basic = req.headers.authorization?.startsWith('Basic ') ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString('utf8').split(':') : [];
        if ((body.get('client_id') ?? basic[0]) !== CLIENT || (body.get('client_secret') ?? basic[1]) !== FIXTURE_CLIENT_SECRET) return response(res, 401, { error: 'invalid_client' });
        const code = body.get('code'), authorization = codes.get(code); codes.delete(code);
        if (!authorization || body.get('grant_type') !== 'authorization_code' || body.get('redirect_uri') !== redirectUri || createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url') !== authorization.challenge) return response(res, 400, { error: 'invalid_grant' });
        const now = Math.floor(Date.now() / 1000);
        const payload = `${encode({ alg: 'RS256', kid: 'fixture-rsa', typ: 'JWT' })}.${encode({ iss: issuer, aud: CLIENT, sub: authorization.sub, email: authorization.email, email_verified: true, name: authorization.name, nonce: authorization.nonce, iat: now, exp: now + 300 })}`;
        return response(res, 200, { access_token: `fixture-${randomUUID()}`, token_type: 'Bearer', expires_in: 300, id_token: `${payload}.${sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64url')}` });
      }
      if (req.method === 'GET' && url.pathname === '/logout') {
        const target = url.searchParams.get('post_logout_redirect_uri');
        if (target !== `${app.origin}/auth`) return response(res, 400, { error: 'invalid_logout_redirect' });
        stats.logoutRedirects += 1;
        res.writeHead(302, { location: target, 'cache-control': 'no-store' }); res.end(); return;
      }
      return response(res, 404, { error: 'fixture_route_not_found' });
    } catch { if (!res.headersSent) response(res, 400, { error: 'invalid_fixture_request' }); else res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  issuer = `http://127.0.0.1:${server.address().port}`;
  return { issuer, clientId: CLIENT, redirectUri, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.PAPERCLIP_MIMOUSE_OIDC_FIXTURE !== 'loopback-only') throw Error('Explicit local OIDC fixture opt-in required');
  const fixture = await startOidcFixture();
  console.log(`LOCAL_OIDC_FIXTURE_READY ${fixture.issuer}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await fixture.close(); process.exit(0); });
}
