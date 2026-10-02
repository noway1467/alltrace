import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchPage,
  parseSauceHtml,
  parseYandexHtml,
  parseGoogleHtml,
  normalizeBot,
  searchWeb,
  searchBot,
  parseAscii2dHtml,
  parseBaiduPayload,
  searchAscii2d,
  searchBaidu,
  parseIqdbHtml,
  searchIqdb,
  enrichAnimeCovers,
  googleConsentRejection,
} from '../worker/providers.js';
const signal = () => AbortSignal.timeout(5000);
const image = {
  file: new Blob([new Uint8Array([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0])], {
    type: 'image/jpeg',
  }),
  width: 12,
  height: 12,
};

test('SauceNAO HTML 提取图片、出处与分数，保留敏感图片保护', () => {
  const html =
    '<div class="result"><div class="resultimage"><img src="https://img3.saucenao.com/a.jpg" raw-rating="1"></div><div class="resultsimilarityinfo">92.5%</div><div class="resulttitle">作品 &amp; 原作</div><div class="resultcontentcolumn">画师 A</div><div class="resultcontent"><a href="https://www.pixiv.net/artworks/12">原作</a></div></div>';
  const parsed = parseSauceHtml(html);
  assert.equal(parsed.recognized, true);
  assert.equal(parsed.results.length, 1);
  assert.equal(parsed.results[0].similarity, 92.5);
  assert.equal(parsed.results[0].title, '作品 & 原作');
  assert.equal(parsed.results[0].thumbnail, 'https://img3.saucenao.com/a.jpg');
  assert.equal(parsed.results[0].sensitive, false);
  assert.equal(
    parseSauceHtml(html.replace('raw-rating="1"', 'class="pixelated" raw-rating="0"')).results[0]
      .sensitive,
    true,
  );
  assert.equal(parseSauceHtml(html.replace('raw-rating="1"', 'raw-rating="3"')).results.length, 0);
});
test('Yandex 解析真实页面结构和协议相对缩略图', () => {
  const html =
    '<div class="CbirSitesPage"><div class="CbirSites-Item"><div class="CbirSites-ItemThumb"><img src="//avatars.mds.yandex.net/test.jpg"></div><div class="CbirSites-ItemTitle"><a href="https://github.com/test/image">图片来源</a></div><span class="CbirSites-ItemDomain">github.com</span></div></div>';
  const result = parseYandexHtml(html).results[0];
  assert.equal(result.thumbnail, 'https://avatars.mds.yandex.net/test.jpg');
  assert.equal(result.similarity, null);
  assert.equal(result.title, '图片来源');
  assert.equal(
    parseYandexHtml(html.replace('//avatars.mds.yandex.net/test.jpg', '')).results[0].thumbnail,
    '',
  );
});
test('Google 解析旧版、当前卡片和 hydration 视觉匹配', () => {
  assert.equal(parseGoogleHtml('<html>Please enable JavaScript</html>').recognized, false);
  const html = [
    '<div class="vEWxFf"><a class="LBcIee" href="https://www.pixiv.net/artworks/1"><span class="Yt787">旧版结果</span></a><img src="https://images.example.org/old.jpg"></div>',
    '<div class="G19kAf ENn9pd"><a href="https://www.pixiv.net/artworks/2"><div class="UAiK1e">当前卡片</div><div class="fjbPGe">Pixiv</div><img class="wETe9b" src="https://encrypted-tbn0.gstatic.com/images?q=current.jpg"></a></div>',
    '<div class="N54PNb"><a href="https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fpage"><img src="https://images.example.org/new.jpg"><h3>新版结果</h3><span>example.com</span></a></div>',
    '<script>AF_initDataCallback({key:"ds:1",hash:"x",data:[["标题","Pixiv","https://encrypted-tbn0.gstatic.com/images?q=data.jpg","https://www.pixiv.net/artworks/3"]],sideChannel:{}});</script>',
  ].join('');
  const parsed = parseGoogleHtml(html);
  assert.equal(parsed.recognized, true);
  assert.equal(parsed.results.length, 4);
  assert.equal(
    parsed.results.find((result) => result.title === '新版结果').url,
    'https://example.com/page',
  );
  assert.equal(
    parsed.results.find((result) => result.title === '标题').thumbnail,
    'https://encrypted-tbn0.gstatic.com/images?q=data.jpg',
  );
  assert.equal(
    parseGoogleHtml(
      html.replace('https://www.pixiv.net/artworks/1', 'javascript:alert(1)'),
    ).results.some((result) => result.title === '旧版结果'),
    false,
  );
});
test('Bot 酱提取 thumbnail_url / metadata / source，不伪造百分比', () => {
  const result = normalizeBot({
    results: [
      {
        score: 25.4,
        path_segments: [
          {
            thumbnail_url: 'https://images.example.org/a.jpg',
            source_url: 'https://site.example.org/art/1',
            metadata: {
              title: { primary: '插画' },
              source: { name: '图库' },
              creators: [{ name: '作者' }],
            },
          },
        ],
      },
    ],
  })[0];
  assert.equal(result.title, '插画');
  assert.equal(result.thumbnail, 'https://images.example.org/a.jpg');
  assert.equal(result.similarity, null);
  assert.match(result.scoreLabel, /25.4.*低置信度/);
  assert.equal(result.sensitive, true);
});
test('Bot URL 明确返回仅支持文件，不静默变成外链', async () => {
  await assert.rejects(
    () =>
      searchBot(
        { url: 'https://images.example.org/a.jpg' },
        () => {
          throw Error('不应访问');
        },
        signal(),
      ),
    /只接受文件/,
  );
});
test('Yandex 文件真实转发到 ru 站点，302 后改为 GET 且不传图片', async () => {
  let calls = 0;
  const data = await searchWeb(
    'yandex',
    image,
    async (url, init) => {
      calls++;
      if (calls === 1) {
        assert.equal(new URL(url).hostname, 'yandex.ru');
        assert.equal(init.body.get('upfile').type, 'image/jpeg');
        assert.equal(init.body.get('prg'), '1');
        return new Response(null, {
          status: 302,
          headers: { location: '/images/search?cbir_id=test&cbir_page=sites' },
        });
      }
      assert.equal(init.method, 'GET');
      assert.equal(init.body, undefined);
      return new Response('<div class="CbirSitesPage"></div>');
    },
    signal(),
  );
  assert.equal(calls, 2);
  assert.match(data.searchUrl, /cbir_id=test/);
  assert.deepEqual(data.results, []);
});
test('所有网页跳转限制目标主机，不转发到恶意地址', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      fetchPage(
        async () => {
          calls++;
          return new Response(null, {
            status: 302,
            headers: { location: 'https://evil.org/steal' },
          });
        },
        'https://yandex.ru/images/search',
        { method: 'POST', body: new FormData() },
        signal(),
        ['yandex.ru'],
      ),
    /未授权/,
  );
  assert.equal(calls, 1);
});
test('307 上传重定向不重放图片', async () => {
  await assert.rejects(
    () =>
      fetchPage(
        async () => new Response(null, { status: 307, headers: { location: '/other' } }),
        'https://yandex.ru/images/search',
        { method: 'POST', body: new FormData() },
        signal(),
        ['yandex.ru'],
      ),
    /重新转发上传/,
  );
});
test('ascii2d 提取作品、作者和缩略图', () => {
  const parsed = parseAscii2dHtml(
    '<div class="item-box"><img src="/thumbnail/a.jpg"><div class="detail-box gray-link"><h6><small>pixiv</small> <a href="https://www.pixiv.net/users/1">画师</a></h6><h6><a href="https://www.pixiv.net/artworks/9">樱花</a></h6></div></div>',
  );
  assert.equal(parsed.recognized, true);
  assert.equal(parsed.results[0].title, '樱花');
  assert.equal(parsed.results[0].url, 'https://www.pixiv.net/artworks/9');
  assert.equal(parsed.results[0].thumbnail, 'https://ascii2d.net/thumbnail/a.jpg');
  assert.match(parsed.results[0].subtitle, /pixiv/);
});
test('百度首页推荐不当成识图结果，真实来源可以解析', () => {
  assert.equal(
    parseBaiduPayload('<script>window.cardData =[{"cardName":"index"}]</script>').results.length,
    0,
  );
  const parsed = parseBaiduPayload({
    data: {
      list: [
        {
          title: '樱花写真',
          fromurl: 'https://example.com/sakura',
          thumburl: 'https://img.example.org/t.jpg',
        },
      ],
    },
  });
  assert.equal(parsed.results[0].title, '樱花写真');
  assert.equal(parsed.results[0].url, 'https://example.com/sakura');
});
test('ascii2d 上传带上首页令牌和会话 Cookie', async () => {
  let sawToken = false;
  const ok = await searchAscii2d(
    image,
    async (url, init) => {
      if (url === 'https://ascii2d.net/')
        return new Response('<form><input name="authenticity_token" value="tok+en"></form>', {
          headers: { 'set-cookie': '_ascii2d_session=abc; Path=/' },
        });
      assert.equal(init.body.get('authenticity_token'), 'tok+en');
      assert.equal(init.body.get('file') instanceof Blob, true);
      assert.match(init.headers.get('Cookie'), /_ascii2d_session=abc/);
      sawToken = true;
      return new Response(
        '<div class="item-box"><div class="detail-box"><h6><a href="https://example.com/work">作品</a></h6></div></div>',
      );
    },
    signal(),
  );
  assert.equal(sawToken, true);
  assert.equal(ok.results[0].title, '作品');
});
test('ascii2d 遇到验证页时不伪装成成功', async () => {
  const result = await searchAscii2d(
    image,
    async () => new Response('<html><title>Just a moment...</title></html>', { status: 403 }),
    signal(),
  );
  assert.equal(result.status, 'attention');
  assert.deepEqual(result.results, []);
});
test('ascii2d 图片链接使用 /search/url/ 原样拼接', async () => {
  let requested = '';
  const result = await searchAscii2d(
    { url: 'https://example.com/a.jpg' },
    async (url) => {
      requested = String(url);
      return new Response('<html><title>Just a moment...</title></html>', { status: 403 });
    },
    signal(),
  );
  assert.equal(requested, 'https://ascii2d.net/search/url/https://example.com/a.jpg');
  assert.equal(result.searchUrl, requested);
});
test('IQDB 提取协议相对链接和相似度', () => {
  const parsed = parseIqdbHtml(
    '<div id="pages"><table><tr><th>Best match</th></tr><tr><td><a href="//danbooru.donmai.us/posts/9"><img alt="樱花" src="//iqdb.org/t.jpg"></a></td><td>92% similarity</td></tr></table></div>',
  );
  assert.equal(parsed.results[0].url, 'https://danbooru.donmai.us/posts/9');
  assert.equal(parsed.results[0].similarity, 92);
  assert.equal(parsed.results[0].thumbnail, 'https://iqdb.org/t.jpg');
});
test('IQDB 按图片链接请求并保留检索地址', async () => {
  let requested = '';
  const result = await searchIqdb(
    { url: 'https://example.com/a.jpg' },
    async (url) => {
      requested = String(url);
      return new Response('<html>No relevant matches</html>');
    },
    signal(),
  );
  assert.match(requested, /^https:\/\/iqdb\.org\/\?url=/);
  assert.equal(result.searchUrl, requested);
  assert.deepEqual(result.results, []);
});
test('百度识图用 sign 拉取相似图', async () => {
  let calls = 0;
  const result = await searchBaidu(
    image,
    async (url) => {
      calls += 1;
      if (calls === 1)
        return new Response(JSON.stringify({ status: 0, data: { sign: 'abc12345' } }));
      assert.match(String(url), /sign=abc12345/);
      return new Response(
        JSON.stringify({
          data: {
            list: [
              {
                title: '相似图',
                fromurl: 'https://example.com/p',
                thumburl: 'https://img.example.org/p.jpg',
              },
            ],
          },
        }),
      );
    },
    signal(),
  );
  assert.equal(result.results[0].title, '相似图');
  assert.equal(result.results[0].url, 'https://example.com/p');
});
test('百度结果页引用验证码脚本时仍按空结果处理', async () => {
  const shell = await searchBaidu(
    image,
    async () =>
      new Response(
        '<html><title>百度识图搜索结果</title><script src="https://wappass.baidu.com/static/machine/js/api/mkd.js"></script></html>',
      ),
    signal(),
  );
  assert.equal(shell.status, 'attention');
  assert.match(shell.note, /没有返回可展示/);
});
test('百度识图的 http 跳转会升到 https', async () => {
  const urls = [];
  const upgraded = await searchBaidu(
    image,
    async (url) => {
      urls.push(String(url));
      if (urls.length === 1)
        return new Response(null, {
          status: 302,
          headers: { location: 'http://shitu.baidu.com/result' },
        });
      assert.equal(new URL(url).protocol, 'https:');
      return new Response(
        JSON.stringify({
          data: {
            list: [
              {
                title: '升到 https',
                fromurl: 'https://example.com/a',
                thumburl: 'https://img.example.org/a.jpg',
              },
            ],
          },
        }),
      );
    },
    signal(),
  );
  assert.equal(upgraded.results[0].title, '升到 https');
});
test('百度识图拒绝图片链接', async () => {
  let requested = '';
  const result = await searchBaidu(
    { url: 'https://example.com/a.jpg' },
    async (url) => {
      requested = String(url);
      return new Response('<html>未找到相关结果</html>');
    },
    signal(),
  );
  assert.match(requested, /https:\/\/graph\.baidu\.com\/details/);
  assert.match(requested, /image=/);
  assert.equal(result.status, undefined);
  assert.deepEqual(result.results, []);
  assert.match(result.note, /没有返回相似图/);
});
test('Google 同意页解析只保留拒绝选项', () => {
  const rejection = googleConsentRejection(
    '<form action="https://consent.google.com/save"><input name="continue" value="https://lens.google.com/v3/upload"><button name="set_eom" value="false">Reject all</button><button name="set_eom" value="true">Accept all</button></form>',
    'https://consent.google.com/m',
  );
  assert.match(rejection.body, /set_eom=false/);
  assert.equal(rejection.body.includes('set_eom=true'), false);
  assert.equal(
    googleConsentRejection(
      '<form action="https://consent.google.com/save"><button name="set_eom" value="true">Accept all</button></form>',
      'https://consent.google.com/m',
    ),
    null,
  );
});
test('Google 同意页只拒绝非必要 Cookie，并把图片重新发给上传地址', async () => {
  const calls = [];
  const consentHtml =
    '<form action="https://consent.google.com/save" method="post"><input name="continue" value="https://lens.google.com/v3/upload?ucbcb=1"><button name="set_eom" value="false">Reject all</button><button name="set_eom" value="true">Accept all</button></form>';
  const result = await searchWeb(
    'google',
    image,
    async (url, init) => {
      const current = new URL(url);
      calls.push(current.hostname + ' ' + init.method + ' ' + current.pathname);
      if (calls.length === 1)
        return new Response(null, {
          status: 302,
          headers: { location: 'https://consent.google.com/m?continue=1' },
        });
      if (current.hostname === 'consent.google.com' && init.method === 'GET')
        return new Response(consentHtml);
      if (current.hostname === 'consent.google.com' && init.method === 'POST') {
        assert.equal(init.body instanceof FormData, false);
        assert.match(String(init.body), /set_eom=false/);
        assert.equal(String(init.body).includes('true'), false);
        return new Response(null, {
          status: 303,
          headers: {
            location: 'https://lens.google.com/v3/upload?ucbcb=1',
            'set-cookie': 'SOCS=anon; Domain=.google.com; Path=/',
          },
        });
      }
      if (current.pathname === '/v3/upload' && init.method === 'GET') return new Response('upload');
      if (current.pathname === '/v3/upload' && init.method === 'POST') {
        assert.equal(init.body.get('encoded_image') instanceof Blob, true);
        assert.match(init.headers.get('Cookie'), /SOCS=anon/);
        return new Response(null, {
          status: 303,
          headers: { location: 'https://www.google.com/search?vsrid=after-consent' },
        });
      }
      return new Response(
        '<div class="N54PNb"><a href="https://example.com/match"><h3>同意后的结果</h3></a></div>',
      );
    },
    signal(),
  );
  assert.equal(result.results[0].title, '同意后的结果');
  assert.equal(calls.filter((call) => call.startsWith('consent.google.com POST')).length, 1);
});
test('Google 同意页没有拒绝按钮时不代为接受', async () => {
  let postedConsent = false;
  const result = await searchWeb(
    'google',
    image,
    async (url, init) => {
      const current = new URL(url);
      if (init.method === 'POST' && current.hostname === 'lens.google.com')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://consent.google.com/m?continue=1' },
        });
      if (current.hostname === 'consent.google.com' && init.method === 'POST') postedConsent = true;
      return new Response(
        '<form action="https://consent.google.com/save"><button name="set_eom" value="true">Accept all</button></form>',
      );
    },
    signal(),
  );
  assert.equal(postedConsent, false);
  assert.equal(result.status, 'attention');
  assert.match(result.note, /不会代为接受/);
});
test('Google 上传后遇到 JS 验证，返回 attention 和本次会话而非成功', async () => {
  let calls = 0;
  const result = await searchWeb(
    'google',
    image,
    async (url, init) => {
      if (++calls === 1) {
        assert.ok(init.body.get('encoded_image'));
        assert.equal(new URL(url).searchParams.get('ep'), 'ccm');
        assert.equal(new URL(url).searchParams.get('sideimagesearch'), '1');
        assert.equal(init.body.get('original_width'), '12');
        assert.equal(init.body.get('processed_image_dimensions'), '12,12');
        return new Response(null, {
          status: 303,
          headers: {
            location: 'https://www.google.com/search?vsrid=test',
            'set-cookie': 'NID=test; Path=/; Secure; HttpOnly',
          },
        });
      }
      assert.equal(init.method, 'GET');
      assert.equal(init.body, undefined);
      assert.equal(init.headers.get('Cookie'), 'NID=test');
      assert.match(init.headers.get('User-Agent'), /Chrome\//);
      return new Response('<html><script>window.sgs()</script></html>');
    },
    signal(),
  );
  assert.equal(result.status, 'attention');
  assert.deepEqual(result.results, []);
  assert.equal(result.searchUrl, 'https://www.google.com/search?vsrid=test');
});
test('Google 上传成功但读取结果网络失败，仍保留上传会话入口', async () => {
  let calls = 0;
  const result = await searchWeb(
    'google',
    image,
    async () => {
      if (++calls === 1)
        return new Response(null, {
          status: 303,
          headers: { location: 'https://www.google.com/search?vsrid=network-test' },
        });
      throw Error('network');
    },
    signal(),
  );
  assert.equal(result.status, 'attention');
  assert.match(result.searchUrl, /network-test/);
});
test('Google 脚本重试页交给浏览器打开，并只传递匿名会话 Cookie', async () => {
  let rendered = 0;
  const result = await searchWeb(
    'google',
    image,
    async (_url, init) => {
      if (init.method === 'POST')
        return new Response(null, {
          status: 303,
          headers: {
            location: 'https://www.google.com/search?vsrid=browser-test',
            'set-cookie':
              'NID=from-upload; Domain=.google.com; Path=/; Secure, SID=login-secret; Domain=.google.com; Path=/',
          },
        });
      return new Response(
        '<html><script>window.sgs();</script>SG_REL' + 'x'.repeat(60000) + '</html>',
      );
    },
    signal(),
    {
      renderPage: async (pageUrl, _pageSignal, cookies) => {
        rendered += 1;
        assert.equal(pageUrl, 'https://www.google.com/search?vsrid=browser-test');
        assert.deepEqual(
          cookies.map((cookie) => cookie.name),
          ['NID'],
        );
        assert.equal(JSON.stringify(cookies).includes('login-secret'), false);
        return {
          url: pageUrl,
          html: '<div class="N54PNb"><a href="https://example.com/match"><h3>樱花来源</h3><img src="https://images.example.org/match.jpg"></a></div>',
        };
      },
    },
  );
  assert.equal(rendered, 1);
  assert.equal(result.status, undefined);
  assert.equal(result.results[0].title, '樱花来源');
  assert.equal(result.results[0].url, 'https://example.com/match');
  assert.equal(result.searchUrl, 'https://www.google.com/search?vsrid=browser-test');
});
test('Google 验证码页不会交给浏览器，浏览器里遇到验证也停止', async () => {
  let rendered = 0;
  const blocked = await searchWeb(
    'google',
    image,
    async (_url, init) => {
      if (init.method === 'POST')
        return new Response(null, {
          status: 303,
          headers: { location: 'https://www.google.com/search?vsrid=captcha-test' },
        });
      return new Response('<html><title>captcha</title><div id="captcha"></div></html>');
    },
    signal(),
    {
      renderPage: async () => {
        rendered += 1;
        return { url: '', html: '' };
      },
    },
  );
  assert.equal(rendered, 0);
  assert.equal(blocked.status, 'attention');
  assert.deepEqual(blocked.results, []);
  const challenged = await searchWeb(
    'google',
    image,
    async (_url, init) => {
      if (init.method === 'POST')
        return new Response(null, {
          status: 303,
          headers: { location: 'https://www.google.com/search?vsrid=after-browser' },
        });
      return new Response('<html><script>window.sgs()</script>SG_REL</html>');
    },
    signal(),
    {
      renderPage: async () => ({
        url: 'https://www.google.com/sorry/index',
        html: '<html><title>captcha</title><div id="captcha"></div></html>',
      }),
    },
  );
  assert.equal(challenged.status, 'attention');
  assert.deepEqual(challenged.results, []);
  assert.equal(challenged.searchUrl, 'https://www.google.com/search?vsrid=after-browser');
});
test('Google 浏览器额度用尽时保留本次检索入口', async () => {
  const result = await searchWeb(
    'google',
    image,
    async (_url, init) => {
      if (init.method === 'POST')
        return new Response(null, {
          status: 303,
          headers: { location: 'https://www.google.com/search?vsrid=quota' },
        });
      return new Response('<html>SG_REL window.sgs()</html>');
    },
    signal(),
    {
      renderPage: async () => {
        throw new Error('429 Browser time limit exceeded for today');
      },
    },
  );
  assert.equal(result.status, 'attention');
  assert.match(result.note, /额度或并发已满/);
  assert.equal(result.searchUrl, 'https://www.google.com/search?vsrid=quota');
});
test('Google 结果页返回 403 脚本重试时仍交给浏览器', async () => {
  let rendered = 0;
  const forbidden = await searchWeb(
    'google',
    image,
    async (_url, init) => {
      if (init.method === 'POST')
        return new Response(null, {
          status: 303,
          headers: { location: 'https://www.google.com/search?vsrid=forbidden' },
        });
      return new Response('<html><script>window.sgs()</script>SG_REL</html>', { status: 403 });
    },
    signal(),
    {
      renderPage: async (pageUrl) => {
        rendered += 1;
        assert.match(pageUrl, /vsrid=forbidden/);
        return {
          url: pageUrl,
          html: '<div class="N54PNb"><a href="https://example.com/match"><h3>403 后的结果</h3></a></div>',
        };
      },
    },
  );
  assert.equal(rendered, 1);
  assert.equal(forbidden.results[0].title, '403 后的结果');
});
test('读取结果失败时仍用浏览器打开已上传的结果地址', async () => {
  let rendered = 0;
  const result = await searchWeb(
    'google',
    image,
    async () => {
      if (rendered === 0) {
        rendered += 1;
        return new Response(null, {
          status: 303,
          headers: { location: 'https://www.google.com/search?vsrid=offline' },
        });
      }
      throw Error('network');
    },
    signal(),
    {
      renderPage: async (pageUrl) => {
        rendered += 1;
        assert.match(pageUrl, /vsrid=offline/);
        return {
          url: pageUrl,
          html: '<div class="N54PNb"><a href="https://example.com/match"><h3>网络失败后的结果</h3></a></div>',
        };
      },
    },
  );
  assert.equal(rendered, 2);
  assert.equal(result.results[0].title, '网络失败后的结果');
});
test('非识别页面和 HTTP 错误不伪装成零结果成功', async () => {
  const result = await searchWeb(
    'yandex',
    image,
    async () => new Response('<h1>maintenance</h1>'),
    signal(),
  );
  assert.equal(result.status, 'attention');
  await assert.rejects(
    () => searchWeb('yandex', image, async () => new Response('error', { status: 500 }), signal()),
    /HTTP 500/,
  );
});
test('AnimeTrace 只有同名作品才补封面，并明确标识来源', async () => {
  const result = await enrichAnimeCovers(
    [
      {
        title: '测试唯一标题',
        subtitle: '角色',
        url: 'https://ai.animedb.cn/',
        similarity: null,
        thumbnail: '',
      },
    ],
    async (url, init) => {
      assert.equal(url, 'https://graphql.anilist.co');
      assert.equal(JSON.parse(init.body).variables.search, '测试唯一标题');
      return Response.json({
        data: {
          Page: {
            media: [
              {
                id: 123,
                title: { native: '测试唯一标题' },
                coverImage: { medium: 'https://s4.anilist.co/cover.jpg' },
              },
            ],
          },
        },
      });
    },
    signal(),
  );
  assert.equal(result[0].thumbnail, 'https://s4.anilist.co/cover.jpg');
  assert.equal(result[0].thumbnailKind, '作品封面 · AniList');
  assert.equal(result[0].similarity, null);
});
test('封面模糊命中不得张冠李戴，服务失败保留文字候选', async () => {
  const input = [{ title: '另一个唯一标题', thumbnail: '', similarity: null }];
  const result = await enrichAnimeCovers(
    input,
    async (url) =>
      url.includes('anilist')
        ? Response.json({
            data: {
              Page: {
                media: [
                  {
                    id: 2,
                    title: { native: '无关标题' },
                    coverImage: { medium: 'https://s4.anilist.co/wrong.jpg' },
                  },
                ],
              },
            },
          })
        : Response.json({ data: [] }),
    signal(),
  );
  assert.equal(result[0].thumbnail, '');
  assert.match(result[0].scoreLabel, /封面暂缺/);
  const failed = await enrichAnimeCovers(
    [{ title: '失败测试标题', thumbnail: '' }],
    async () => {
      throw Error('fail');
    },
    signal(),
  );
  assert.equal(failed.length, 1);
  assert.equal(failed[0].thumbnail, '');
});
