import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleApi,
  publicImageUrl,
  detectImage,
  normalizeTrace,
  normalizeAnimeTrace,
  normalizeSauce,
} from '../worker/index.js';

const sample = 'https://images.plurk.com/32B15UXxymfSMwKGTObY5e.jpg';
const request = (engine = 'trace', options = {}) =>
  new Request('https://alltrace.test/api/search/' + engine, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: sample }),
    ...options,
  });
const reply = (data, status = 200) => Response.json(data, { status });
const traceResult = {
  error: '',
  result: [
    {
      anilist: { id: 21034, title: { native: 'ご注文はうさぎですか？？' }, isAdult: false },
      episode: 1,
      from: 272,
      to: 282,
      similarity: 0.992,
      image: 'https://api.trace.moe/image/example',
    },
  ],
};

test('公开配置只返回能力，不泄露服务端密钥', async () => {
  const r = await handleApi(new Request('https://alltrace.test/api/config'), {
    SAUCENAO_API_KEY: 'secret-test',
    TRACE_API_KEY: 'trace-secret',
  });
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(text).engines.saucenao, true);
  assert.ok(!text.includes('secret'));
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});
test('空白密钥使用匿名网页模式', async () => {
  const r = await handleApi(new Request('https://alltrace.test/api/config'), {
    SAUCENAO_API_KEY: '  ',
  });
  const data = await r.json();
  assert.equal(data.engines.saucenao, true);
  assert.equal(data.modes.saucenao, '匿名网页检索');
});
test('Google、ascii2d 和百度识图出现在配置里', async () => {
  const data = await (await handleApi(new Request('https://alltrace.test/api/config'))).json();
  assert.equal(data.modes.google, '你的浏览器');
  assert.equal(data.engines.ascii2d, true);
  assert.equal(data.modes.baidu, '图片链接');
});
test('上传图片会生成可再次读取的公开链接', async () => {
  const store = new Map();
  const kv = {
    async put(key, value, options) {
      store.set(key, { value, type: options.metadata.type });
    },
    async getWithMetadata(key) {
      const hit = store.get(key);
      return hit
        ? { value: hit.value, metadata: { type: hit.type } }
        : { value: null, metadata: null };
    },
  };
  const form = new FormData();
  form.set(
    'image',
    new Blob([Uint8Array.from([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0])], {
      type: 'image/jpeg',
    }),
    'a.jpg',
  );
  const created = await handleApi(
    new Request('https://alltrace.test/api/temp-image', { method: 'POST', body: form }),
    { TEMP_IMAGES: kv },
  );
  const data = await created.json();
  assert.equal(created.status, 200);
  assert.match(data.url, /^https:\/\/alltrace\.test\/api\/temp-image\/[a-f0-9]{32}$/);
  const image = await handleApi(new Request(data.url), { TEMP_IMAGES: kv });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('Content-Type'), 'image/jpeg');
  assert.equal((await image.arrayBuffer()).byteLength, 12);
});
test('拒绝私有地址、协议、凭据与 URL 混淆', () => {
  for (const url of [
    'http://public.org/a.png',
    'file:///etc/passwd',
    'https://127.0.0.1/a',
    'https://2130706433/a',
    'https://0x7f000001/a',
    'https://[::1]/a',
    'https://localhost/a',
    'https://foo.internal/a',
    'https://a.local/a',
    'https://a.nip.io/a',
    'https://user:pass@public.org/a',
    'https://public.org:8443/a',
  ])
    assert.throws(() => publicImageUrl(url), undefined, url);
  assert.equal(publicImageUrl(sample + '#fragment'), sample);
});
test('校验真实文件头而非客户端 MIME', () => {
  assert.equal(
    detectImage(Uint8Array.from([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    'image/jpeg',
  );
  assert.equal(
    detectImage(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])),
    'image/png',
  );
  assert.equal(detectImage(new TextEncoder().encode('GIF89a1234567')), 'image/gif');
  assert.equal(detectImage(new TextEncoder().encode('RIFF1234WEBP')), 'image/webp');
  assert.equal(detectImage(new TextEncoder().encode('<svg>alert(1)</svg>')), '');
});
test('未知接口与错误方法独立返回 404 / 405', async () => {
  assert.equal((await handleApi(request('unknown'))).status, 404);
  assert.equal(
    (await handleApi(new Request('https://alltrace.test/api/search/trace'))).status,
    405,
  );
});
test('拒绝跨站请求且不调用上游', async () => {
  let called = false;
  const r = await handleApi(
    request('trace', {
      headers: { Origin: 'https://evil.org', 'Content-Type': 'application/json' },
    }),
    {},
    () => {
      called = true;
    },
  );
  assert.equal(r.status, 403);
  assert.equal(called, false);
});
test('限流先于读取上传内容执行', async () => {
  const r = await handleApi(request(), {
    SEARCH_LIMITER: { limit: async () => ({ success: false }) },
  });
  assert.equal(r.status, 429);
});
test('声明的过大请求直接拒绝', async () => {
  const r = await handleApi(
    request('trace', {
      headers: { 'Content-Length': '99999999', 'Content-Type': 'application/json' },
    }),
  );
  assert.equal(r.status, 413);
});
test('无 Content-Length 的超大 JSON 也被流读取上限限制', async () => {
  const r = await handleApi(request('trace', { body: JSON.stringify({ url: 'x'.repeat(5000) }) }));
  assert.equal(r.status, 413);
});
test('非法 JSON 和空值返回可读 400', async () => {
  for (const body of ['{bad', 'null', '{}'])
    assert.equal((await handleApi(request('trace', { body }))).status, 400);
});
test('拒绝非图片文件及非支持请求类型', async () => {
  const form = new FormData();
  form.set('image', new Blob(['<svg>fake-image</svg>'], { type: 'image/png' }), 'fake.png');
  assert.equal((await handleApi(request('trace', { body: form, headers: {} }))).status, 415);
  assert.equal(
    (await handleApi(request('trace', { headers: { 'Content-Type': 'text/plain' } }))).status,
    415,
  );
});
test('trace URL 采用官方 GET 参数，不自动跟随重定向', async () => {
  const r = await handleApi(request(), { TRACE_API_KEY: 'test-key' }, async (url, init) => {
    assert.equal(url.origin, 'https://api.trace.moe');
    assert.equal(url.searchParams.get('url'), sample);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers['x-trace-key'], 'test-key');
    assert.ok(!url.href.includes('test-key'));
    return reply(traceResult);
  });
  const data = await r.json();
  assert.equal(r.status, 200);
  assert.equal(data.results[0].similarity, 99.2);
  assert.equal(data.results[0].subtitle, '第 1 集 · 04:32 ~ 04:42');
});
test('trace 上传使用原始图片二进制与准确的 MIME', async () => {
  const form = new FormData();
  form.set(
    'image',
    new Blob([Uint8Array.from([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0])], { type: 'image/jpeg' }),
    'private-name.jpg',
  );
  const r = await handleApi(
    request('trace', { body: form, headers: {} }),
    {},
    async (url, init) => {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['Content-Type'], 'image/jpeg');
      assert.ok(init.body instanceof Blob);
      return reply(traceResult);
    },
  );
  assert.equal(r.status, 200);
});
test('AnimeTrace 动态选择当前可用默认模型并返回无伪造分数的候选', async () => {
  let calls = 0;
  const r = await handleApi(request('animetrace'), {}, async (url, init) => {
    calls++;
    if (String(url).startsWith('https://api.bgm.tv/')) return reply({ data: [] });
    if (String(url).includes('graphql.anilist.co')) return reply({ data: { Page: { media: [] } } });
    if (String(url).endsWith('/model/list'))
      return reply({
        data: [
          { id: 'old', enabled: false, default: true },
          { id: 'current', enabled: true, default: true },
        ],
      });
    assert.equal(init.body.get('model'), 'current');
    assert.equal(init.body.get('url'), sample);
    assert.equal(init.body.get('is_multi'), '1');
    return reply({
      code: 0,
      ai: false,
      data: [{ not_confident: true, character: [{ work: '作品', character: '角色' }] }],
    });
  });
  assert.equal(r.status, 200);
  assert.equal(calls, 4);
  const data = await r.json();
  assert.equal(data.results[0].similarity, null);
  assert.match(data.results[0].subtitle, /待确认/);
});
test('所有 AnimeTrace 模型下线时返回可用性错误', async () => {
  const r = await handleApi(request('animetrace'), {}, async () =>
    reply({ data: [{ enabled: false }] }),
  );
  assert.equal(r.status, 503);
});
test('SauceNAO 缺少密钥时提交匿名网页搜索', async () => {
  const r = await handleApi(request('saucenao'), {}, async (url, init) => {
    assert.equal(url, 'https://saucenao.com/search.php');
    assert.equal(init.body.get('api_key'), null);
    assert.equal(init.body.get('url'), sample);
    return new Response('<html>No results found</html>');
  });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).results, []);
});
test('SauceNAO 使用服务端密钥和安全搜索参数', async () => {
  const r = await handleApi(
    request('saucenao'),
    { SAUCENAO_API_KEY: 'private' },
    async (url, init) => {
      assert.equal(url, 'https://saucenao.com/search.php');
      assert.equal(init.body.get('api_key'), 'private');
      assert.equal(init.body.get('hide'), '3');
      return reply({ header: { status: 0 }, results: [] });
    },
  );
  assert.equal(r.status, 200);
  assert.ok(!(await r.text()).includes('private'));
});
test('上游限额、拒绝、重定向、异常数据与超时分别降级', async () => {
  for (const [upstream, expected] of [
    [429, 429],
    [403, 502],
    [500, 502],
    [302, 502],
  ]) {
    const r = await handleApi(request(), {}, async () => new Response('', { status: upstream }));
    assert.equal(r.status, expected);
  }
  assert.equal(
    (await handleApi(request(), {}, async () => new Response('<html>captcha</html>'))).status,
    502,
  );
  assert.equal(
    (
      await handleApi(request(), {}, async () => {
        throw new DOMException('timeout', 'TimeoutError');
      })
    ).status,
    504,
  );
});
test('不向客户端泄漏网络异常详情', async () => {
  const r = await handleApi(request(), {}, async () => {
    throw new Error('secret-key=private');
  });
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes('private'));
});
test('结果链接过滤脚本和私网，已标记成人条目被隐藏', () => {
  const trace = normalizeTrace({ result: [...traceResult.result, { anilist: { isAdult: true } }] });
  assert.equal(trace.length, 1);
  const sauce = normalizeSauce({
    results: [
      { header: { hidden: 1 } },
      {
        header: { similarity: '90', thumbnail: 'javascript:alert(1)' },
        data: {
          title: '安全渲染',
          ext_urls: [
            'https://localhost/a',
            'javascript:alert(1)',
            'https://www.pixiv.net/artworks/123',
          ],
        },
      },
    ],
  });
  assert.equal(sauce.length, 1);
  assert.equal(sauce[0].thumbnail, '');
  assert.equal(sauce[0].url, 'https://www.pixiv.net/artworks/123');
});
test('多个人脸重复角色合并且结果数量受限', () => {
  const repeated = { character: [{ work: '作品', character: '角色' }] };
  assert.equal(normalizeAnimeTrace({ data: [repeated, repeated] }).length, 1);
  assert.equal(normalizeTrace({ result: Array(20).fill(traceResult.result[0]) }).length, 6);
});
