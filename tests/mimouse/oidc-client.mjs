/** Test client for an explicitly owned loopback application + oidc-fixture.mjs.
 * Cookies stay in this closure and are never persisted or printed.
 */
export async function fixtureSignIn(subject, { appOrigin = 'http://127.0.0.1:3101', issuer = 'http://127.0.0.1:3102' } = {}) {
  if (!['owner', 'member', 'outsider', 'legacy'].includes(subject)) throw Error('Unknown fixture subject');
  for (const raw of [appOrigin, issuer]) { const url = new URL(raw); if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== raw || url.username || url.password) throw Error('Fixture client requires exact loopback origins'); }
  const cookies = new Map();
  async function app(path, { method = 'GET', body } = {}) {
    if (!path.startsWith('/api/') || new URL(path, appOrigin).origin !== appOrigin) throw Error('Fixture client only requests the fixed app API');
    const response = await fetch(appOrigin + path, { method, redirect: 'manual', headers: { origin: appOrigin, cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const value of response.headers.getSetCookie()) { const pair = value.split(';', 1)[0], index = pair.indexOf('='); const name = pair.slice(0, index), content = pair.slice(index + 1); if (content) cookies.set(name, content); else cookies.delete(name); }
    return response;
  }
  const begun = await app('/api/auth/sign-in/social', { method: 'POST', body: { provider: 'casdoor', callbackURL: '/', disableRedirect: true } });
  if (!begun.ok) throw Error(`Fixture sign-in failed: ${begun.status}`);
  const authorization = new URL((await begun.json()).url);
  if (authorization.origin !== issuer || authorization.pathname !== '/authorize') throw Error('Unexpected fixture provider');
  const screen = await fetch(authorization, { redirect: 'error' }); if (!screen.ok) throw Error('Fixture authorization screen rejected');
  const request = /name="request" value="([a-f0-9-]+)"/.exec(await screen.text())?.[1]; if (!request) throw Error('Fixture form missing');
  const authorized = await fetch(`${issuer}/authorize`, { method: 'POST', headers: { origin: issuer }, body: new URLSearchParams({ request, subject }), redirect: 'manual' });
  if (authorized.status !== 302) throw Error('Fixture identity rejected');
  const callback = new URL(authorized.headers.get('location'));
  if (callback.origin !== appOrigin || callback.pathname !== '/api/auth/callback/casdoor') throw Error('Unexpected callback target');
  const result = await app(callback.pathname + callback.search);
  if (result.status !== 302 || (result.headers.get('location') ?? '').includes('error')) throw Error('Fixture callback rejected');
  const session = await (await app('/api/auth/get-session')).json();
  if (session?.user?.email !== `${subject}@paperclip-fixture.invalid`) throw Error('Fixture session identity mismatch');
  return { userId: session.user.id, request: app, async json(path, options) { const response = await app(path, options); if (!response.ok) throw Error(`Fixture API ${path.split('?')[0]} failed: ${response.status}`); return response.json(); } };
}
