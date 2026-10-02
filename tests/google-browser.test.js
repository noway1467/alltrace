import test from 'node:test';
import assert from 'node:assert/strict';
import {
  googleResultUrl,
  googleSessionCookies,
  renderGooglePage,
} from '../worker/google-browser.js';

test('浏览器地址只允许 Google 结果页', async () => {
  assert.equal(
    googleResultUrl('https://www.google.com/search?vsrid=ok'),
    'https://www.google.com/search?vsrid=ok',
  );
  assert.equal(googleResultUrl('https://www.google.com/httpservice/retry/enablejs?sei=1'), '');
  assert.equal(googleResultUrl('https://www.google.com/sorry/index'), '');
  assert.equal(googleResultUrl('https://evil.example/search'), '');
  assert.equal(googleResultUrl('http://www.google.com/search'), '');
  await assert.rejects(
    () => renderGooglePage({}, 'https://www.google.com/httpservice/retry/enablejs?sei=1'),
    /未授权或验证/,
  );
});
test('会话 Cookie 只保留本次匿名上传，不接收登录 Cookie', () => {
  const cookies = googleSessionCookies([
    { name: 'NID', value: 'anon', domain: '.google.com', path: '/' },
    { name: 'SID', value: 'login-secret', domain: '.google.com', path: '/' },
    { name: 'NID', value: 'elsewhere', domain: 'example.com', path: '/' },
  ]);
  assert.deepEqual(
    cookies.map((cookie) => cookie.name),
    ['NID'],
  );
  assert.equal(JSON.stringify(cookies).includes('login-secret'), false);
});
