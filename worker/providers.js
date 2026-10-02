import { load } from 'cheerio/slim';
import { ApiError, boundedBytes, imageForm, safeLink, upstreamJson } from './http.js';
import { googleResultUrl, googleSessionCookies } from './google-browser.js';

const TEXT_LIMIT = 3 * 1024 * 1024;
const clean = (value, max = 220) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
function imageLink(value, base) {
  if (!value) return '';
  if (
    /^data:image\/(?:jpeg|png|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(value || '') &&
    value.length < 100000
  )
    return value;
  try {
    return safeLink(new URL(value || '', base).href);
  } catch {
    return '';
  }
}

// 只跟随当前服务自己的页面跳转，不携带用户 Cookie，也不执行网页脚本。
export async function fetchPage(fetcher, url, init, signal, hosts) {
  let current = new URL(url);
  let options = init;
  const cookies = new Map();
  const sessionCookies = new Map();
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (
      current.protocol !== 'https:' ||
      !hosts.includes(current.hostname) ||
      current.username ||
      current.password ||
      (current.port && current.port !== '443')
    )
      throw new ApiError('搜索引擎跳转到了未授权地址。', 502);
    let response;
    try {
      const headers = new Headers(options.headers || {});
      if (cookies.size)
        headers.set('Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
      response = await fetcher(current.href, {
        ...options,
        headers,
        signal,
        redirect: 'manual',
      });
    } catch {
      if (redirects > 0 && init.method === 'POST')
        return {
          status: 599,
          url: current.href,
          html: '',
          cookies: [...sessionCookies.values()],
        };
      throw new ApiError(
        signal.aborted ? '搜索超时，请重试。' : '搜索引擎连接失败，请稍后重试。',
        signal.aborted ? 504 : 502,
      );
    }
    const cookieHeaders =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')];
    for (const header of cookieHeaders) {
      if (!header) continue;
      for (const part of header.split(/,(?=\s*[^=;,\s]+=[^;,\s]*)/)) {
        const pieces = part.split(';');
        const pair = pieces[0];
        const separator = pair.indexOf('=');
        if (separator <= 0) continue;
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (!name) continue;
        cookies.set(name, value);
        let domain = current.hostname;
        let path = '/';
        for (const attr of pieces.slice(1)) {
          const eq = attr.indexOf('=');
          const key = (eq === -1 ? attr : attr.slice(0, eq)).trim().toLowerCase();
          const attrValue = eq === -1 ? '' : attr.slice(eq + 1).trim();
          if (key === 'domain' && attrValue) domain = attrValue;
          if (key === 'path' && attrValue.startsWith('/')) path = attrValue;
        }
        sessionCookies.set(name, { name, value, domain, path });
      }
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new ApiError('搜索引擎返回了无效跳转。', 502);
      if ([307, 308].includes(response.status) && options.method === 'POST')
        throw new ApiError('搜索引擎要求重新转发上传，已为保护图片停止请求。', 502);
      current = new URL(location, current);
      // 部分站点用 http 跳回自己的结果页。只对白名单主机升到 https，不跟随明文地址。
      if (current.protocol === 'http:' && hosts.includes(current.hostname))
        current.protocol = 'https:';
      // 302/303 后是查看结果的 GET，绝不把文件或 API Key 发给重定向页。
      const redirectHeaders = new Headers(options.headers || {});
      redirectHeaders.delete('content-type');
      redirectHeaders.delete('content-length');
      options = {
        method: 'GET',
        headers: redirectHeaders,
      };
      continue;
    }
    if (response.status === 429) throw new ApiError('此站当前请求过多，请稍后再试。', 429);
    const html = new TextDecoder().decode(await boundedBytes(response.body, TEXT_LIMIT));
    return {
      status: response.status,
      url: current.href,
      html,
      cookies: [...sessionCookies.values()],
    };
  }
  throw new ApiError('搜索引擎跳转次数过多。', 502);
}

export function parseSauceHtml(html) {
  const $ = load(html);
  const results = [];
  $('.result').each((_, node) => {
    const card = $(node),
      img = card.find('.resultimage img').first();
    // 保留原站遮罩语义，绝不读取 data-src2 来绕开隐藏图。
    const rating = img.attr('raw-rating');
    if (rating != null && Number(rating) > 1) return;
    const url = card
      .find('.resultcontent a, .resultmiscinfo a')
      .map((_, a) => safeLink($(a).attr('href')))
      .get()
      .find(Boolean);
    const score = Number.parseFloat(card.find('.resultsimilarityinfo').text());
    if (!Number.isFinite(score)) return;
    const title = clean(card.find('.resulttitle').text()) || '图片来源';
    results.push({
      title,
      subtitle: clean(card.find('.resultcontentcolumn').text()),
      similarity: Math.max(0, Math.min(100, score)),
      thumbnail: imageLink(img.attr('src'), 'https://saucenao.com/'),
      thumbnailKind: '匹配图片',
      sensitive: img.hasClass('pixelated'),
      url: url || 'https://saucenao.com/',
    });
  });
  return {
    results: results.slice(0, 6),
    recognized: $('.result').length > 0 || /No results found|No matches found/i.test($.text()),
  };
}

export function parseYandexHtml(html) {
  const $ = load(html),
    results = [];
  $('.CbirSites-Item').each((_, node) => {
    const card = $(node),
      link = card.find('.CbirSites-ItemTitle a').first();
    const url = safeLink(link.attr('href'));
    if (!url) return;
    results.push({
      title: clean(link.text()),
      subtitle: clean(card.find('.CbirSites-ItemDomain').text()),
      url,
      thumbnail: imageLink(
        card.find('.CbirSites-ItemThumb img').attr('src') ||
          card.find('.CbirSites-ItemThumb img').attr('data-src') ||
          card.find('.CbirSites-ItemThumb a').attr('href'),
        'https://yandex.com/',
      ),
      thumbnailKind: '匹配图片',
      similarity: null,
      scoreLabel: '图片来源页面',
    });
  });
  return {
    results: results.slice(0, 6),
    recognized: $('.CbirSitesPage').length > 0 || $('.CbirSites-Item').length > 0,
  };
}

const googleResultSelector = '.vEWxFf, .G19kAf.ENn9pd, .N54PNb, [data-item-id]';

function googleExternalLink(value, base = 'https://lens.google.com/') {
  try {
    let url = new URL(value || '', base);
    if (url.hostname === 'google.com' || url.hostname.endsWith('.google.com')) {
      if (url.pathname === '/url' || url.pathname === '/url/')
        url = new URL(url.searchParams.get('url') || url.searchParams.get('q') || '');
      else return '';
    }
    return safeLink(url.href);
  } catch {
    return '';
  }
}

export function parseGoogleHtml(html) {
  const $ = load(html),
    results = [],
    images = new Map(),
    seen = new Set();

  function addResult({ title, subtitle, url, thumbnail }) {
    if (!url || !title || seen.has(url)) return;
    seen.add(url);
    results.push({
      title: clean(title),
      subtitle: clean(subtitle) || new URL(url).hostname,
      url,
      similarity: null,
      scoreLabel: '视觉匹配',
      thumbnail: imageLink(thumbnail, 'https://lens.google.com/'),
      thumbnailKind: '匹配图片',
    });
  }

  // 旧版页面把部分缩略图放在脚本变量里，保留兼容，不执行任何脚本。
  for (const script of $('script').toArray()) {
    const text = $(script).text();
    const data = text.match(/var s='(data:image\/[^']+)';/);
    const ids = text.match(/var ii=\[([^\]]+)\];/);
    if (data && ids)
      for (const id of ids[1].matchAll(/'([^']+)'/g))
        images.set(id[1], data[1].replace(/\\x3d/g, '='));
  }

  // Google 会轮换卡片类名。优先读取当前 N54PNb / G19kAf 结构，再兼容旧版 vEWxFf。
  $('a.LBcIee, .G19kAf.ENn9pd a[href], .N54PNb a[href], [data-item-id] a[href]').each((_, node) => {
    const anchor = $(node),
      url = googleExternalLink(anchor.attr('href'));
    if (!url) return;
    const card = anchor.closest(googleResultSelector).first(),
      scope = card.length ? card : anchor.parent(),
      title =
        clean(scope.find('.UAiK1e, .Yt787, h3, [role="heading"]').first().text()) ||
        clean(anchor.attr('aria-label')) ||
        clean(anchor.text()),
      source =
        clean(scope.find('.fjbPGe, .VuuXrf').first().text()) ||
        new URL(url).hostname.replace(/^www\./, ''),
      img = scope.find('img').first(),
      srcset = (img.attr('srcset') || '').split(',')[0]?.trim().split(/\s+/)[0],
      thumbnail = imageLink(
        images.get(img.attr('id')) || img.attr('data-src') || img.attr('src') || srcset,
        'https://lens.google.com/',
      );
    addResult({ title, subtitle: source, url, thumbnail });
  });

  function walkGoogleData(node) {
    if (!Array.isArray(node)) return;
    const urls = node.filter((value) => typeof value === 'string' && /^https?:\/\//i.test(value));
    const thumbnail = urls.find((url) => /encrypted-tbn|gstatic|googleusercontent/i.test(url));
    const link = urls.map((url) => googleExternalLink(url)).find(Boolean);
    if (thumbnail && link) {
      const strings = node.filter(
        (value) =>
          typeof value === 'string' && value.trim().length > 1 && !/^https?:\/\//i.test(value),
      );
      addResult({
        title: strings[0] || new URL(link).hostname,
        subtitle: strings[1] || new URL(link).hostname,
        url: link,
        thumbnail,
      });
      return;
    }
    for (const child of node) walkGoogleData(child);
  }

  // 当前 Lens 的完整结果通常藏在 AF_initDataCallback hydration 数据中。
  for (const script of $('script').toArray()) {
    const text = $(script).text();
    for (const match of text.matchAll(
      /AF_initDataCallback\s*\(\s*\{[\s\S]*?data:\s*(\[[\s\S]*?\])\s*,\s*sideChannel/g,
    )) {
      try {
        const data = JSON.parse(
          match[1].replace(/\\x([0-9a-f]{2})/gi, (_, hex) =>
            String.fromCharCode(Number.parseInt(hex, 16)),
          ),
        );
        walkGoogleData(data);
      } catch {
        // 某一块 hydration 数据不可解析时继续检查后续块。
      }
      if (results.length >= 6) break;
    }
    if (results.length >= 6) break;
  }

  const markers = $(googleResultSelector).length > 0;
  const noResults = /No results found|No matches found|没有找到.*(?:图片|结果)/i.test($.text());
  return { results: results.slice(0, 6), recognized: markers || noResults || results.length > 0 };
}

function classifyFetchedPage(page) {
  const html = String(page?.html || '');
  const url = String(page?.url || '');
  const title = html.match(/<title>([^<]{0,180})<\/title>/i)?.[1] || '';
  const urlBlocked = ['showcaptcha', '/sorry/', 'consent.google'].some((part) =>
    url.includes(part),
  );
  const titleBlocked = /just a moment|captcha|robot/i.test(title);
  const markupBlocked =
    html.length < 50_000 &&
    /id="captcha|id="recaptcha|action="[^"<>]*checkcaptcha|sorry\/index|unusual traffic/i.test(
      html,
    );
  const hardBlock = urlBlocked || titleBlocked || markupBlocked;
  // 大体积的 SG_REL 也是脚本重试，不能因为超过 5 万字节就被当成普通页面。
  const jsRetry =
    !hardBlock && /SG_REL|window[.]sgs|httpservice\/retry\/enablejs/i.test(html.slice(0, 150_000));
  const legacySmall =
    html.length < 50_000 &&
    /<title>[^<]*(?:just a moment|captcha|robot|robot check)|Our systems have detected unusual traffic|id="captcha|id="recaptcha|action="[^"<>]*checkcaptcha|window[.]sgs|SG_REL|sorry\/index/i.test(
      html,
    );
  return { hardBlock, jsRetry, challenge: hardBlock || jsRetry || legacySmall || urlBlocked };
}

function browserFailureNote(error) {
  const message = String(error?.message || '');
  if (/429|time limit|too many|rate limit|acquire|concurrent/i.test(message))
    return '图片已上传，但浏览器渲染额度或并发已满。请稍后再试，或打开本次检索；不会自动处理验证码。';
  return '图片已上传，但浏览器没能打开结果页。可打开本次检索继续；不会自动处理验证码。';
}

// 同意页只提交「全部拒绝」。找不到拒绝按钮时不代为接受。
export function googleConsentRejection(html, pageUrl) {
  const $ = load(html || '');
  const form = $('form[action]')
    .filter((_, el) => {
      try {
        return new URL($(el).attr('action') || '', pageUrl).hostname === 'consent.google.com';
      } catch {
        return false;
      }
    })
    .first();
  if (!form.length) return null;
  const action = new URL(form.attr('action'), pageUrl);
  if (action.protocol !== 'https:') return null;
  const fields = new URLSearchParams();
  form.find('input[name]').each((_, el) => {
    const type = ($(el).attr('type') || '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'image') return;
    fields.set($(el).attr('name'), $(el).attr('value') || '');
  });
  const reject = form
    .find('button[name], input[type="submit"][name]')
    .toArray()
    .map((el) => ({
      name: $(el).attr('name') || '',
      value: $(el).attr('value') || '',
      text: clean($(el).text() + ' ' + ($(el).attr('aria-label') || '')),
    }))
    .find(
      (control) =>
        /reject|decline|disagree|拒绝|不同意/i.test(control.text) ||
        ((control.name === 'set_eom' || control.name === 'set_sc') && control.value === 'false'),
    );
  if (!reject?.name) return null;
  fields.set(reject.name, reject.value);
  return { action: action.href, body: fields.toString() };
}

async function continueAfterGoogleConsent(page, fetcher, signal, headers, form, hosts) {
  const rejection = googleConsentRejection(page.html, page.url);
  if (!rejection) return null;
  const cookieHeader = (cookies) =>
    googleSessionCookies(cookies)
      .map((cookie) => cookie.name + '=' + cookie.value)
      .join('; ');
  const consentHeaders = new Headers(headers);
  const initialCookie = cookieHeader(page.cookies);
  if (initialCookie) consentHeaders.set('Cookie', initialCookie);
  consentHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
  consentHeaders.set('Origin', 'https://consent.google.com');
  consentHeaders.set('Referer', page.url);
  const saved = await fetchPage(
    fetcher,
    rejection.action,
    { method: 'POST', headers: consentHeaders, body: rejection.body },
    signal,
    hosts,
  );
  let next;
  try {
    next = new URL(saved.url);
  } catch {
    return saved;
  }
  // 同意页会把浏览器送回上传地址，但不会带上图片。只向这个上传地址再发一次。
  if (next.hostname === 'lens.google.com' && next.pathname === '/v3/upload') {
    const retryHeaders = new Headers(headers);
    const retryCookie = cookieHeader(saved.cookies);
    if (retryCookie) retryHeaders.set('Cookie', retryCookie);
    return fetchPage(
      fetcher,
      saved.url,
      { method: 'POST', headers: retryHeaders, body: form },
      signal,
      hosts,
    );
  }
  return saved;
}

export async function searchWeb(engine, input, fetcher, signal, options = {}) {
  const form = new FormData();
  let url, hosts;
  if (engine === 'saucenao') {
    url = 'https://saucenao.com/search.php';
    hosts = ['saucenao.com', 'www.saucenao.com'];
    if (input.file) form.set('file', input.file, 'image.jpg');
    else form.set('url', input.url);
    form.set('hide', '3');
    form.set('numres', '6');
    form.set('db', '999');
  } else if (engine === 'yandex') {
    url = 'https://yandex.ru/images/search?rpt=imageview&cbir_page=sites';
    hosts = ['yandex.com', 'yandex.ru'];
    if (input.file) {
      form.set('upfile', input.file, 'image.jpg');
      form.set('prg', '1');
    } else url += '&url=' + encodeURIComponent(input.url);
  } else {
    hosts = ['lens.google.com', 'www.google.com', 'consent.google.com'];
    if (input.file) {
      const lensUrl = new URL('https://lens.google.com/v3/upload');
      lensUrl.searchParams.set('hl', 'en-US');
      lensUrl.searchParams.set('ep', 'ccm');
      lensUrl.searchParams.set('re', 'dcsp');
      lensUrl.searchParams.set('s', '4');
      lensUrl.searchParams.set('st', String(Date.now()));
      lensUrl.searchParams.set('sideimagesearch', '1');
      lensUrl.searchParams.set('vpw', '1920');
      lensUrl.searchParams.set('vph', '1080');
      url = lensUrl.href;
      form.set('encoded_image', input.file, 'image.jpg');
      if (input.width > 0 && input.height > 0) {
        form.set('original_width', String(input.width));
        form.set('original_height', String(input.height));
        form.set('processed_image_dimensions', `${input.width},${input.height}`);
      }
    } else {
      const lensUrl = new URL('https://lens.google.com/uploadbyurl');
      lensUrl.searchParams.set('url', input.url);
      lensUrl.searchParams.set('hl', 'en-US');
      lensUrl.searchParams.set('re', 'df');
      lensUrl.searchParams.set('ep', 'cntpubb');
      url = lensUrl.href;
    }
  }
  const method = input.file || engine === 'saucenao' ? 'POST' : 'GET';
  const googleHeaders = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Origin: 'https://lens.google.com',
    Referer: 'https://lens.google.com/',
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
  };
  let page = await fetchPage(
    fetcher,
    url,
    {
      method,
      ...(method === 'POST' ? { body: form } : {}),
      headers:
        engine === 'google'
          ? googleHeaders
          : { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    },
    signal,
    hosts,
  );
  if (engine === 'google' && input.file && String(page.url).includes('consent.google.com')) {
    const continued = await continueAfterGoogleConsent(
      page,
      fetcher,
      signal,
      googleHeaders,
      form,
      hosts,
    );
    if (continued) page = continued;
  }
  const block = classifyFetchedPage(page);
  if (
    engine === 'google' &&
    (block.jsRetry || page.status === 599 || page.status === 403) &&
    !block.hardBlock &&
    typeof options.renderPage === 'function'
  ) {
    const target = googleResultUrl(page.url);
    if (target) {
      let rendered;
      try {
        rendered = await options.renderPage(target, signal, googleSessionCookies(page.cookies));
      } catch (error) {
        return {
          results: [],
          status: 'attention',
          searchUrl: target,
          note: browserFailureNote(error),
        };
      }
      const html = typeof rendered?.html === 'string' ? rendered.html : '';
      const renderedBlock = classifyFetchedPage({ html, url: rendered?.url || '', status: 200 });
      const renderedUrl = googleResultUrl(rendered?.url) || target;
      if (html && !renderedBlock.hardBlock) {
        const parsed = parseGoogleHtml(html);
        if (parsed.recognized)
          return {
            results: parsed.results,
            searchUrl: renderedUrl,
            note: '已用浏览器打开本次上传的 Google 结果页并提取视觉匹配。非官方 API；免费版浏览器时间有限，验证码不会自动处理。',
          };
      }
      return {
        results: [],
        status: 'attention',
        searchUrl: target,
        note: renderedBlock.hardBlock
          ? '图片已上传，但 Google 要求完成验证。本站不会自动处理验证码，可打开本次检索继续。'
          : '图片已上传，浏览器打开后仍没有可展示的匹配。可打开本次检索继续；不会自动处理验证码。',
      };
    }
  }
  if (block.challenge || page.status === 403 || page.status === 599) {
    return {
      results: [],
      status: 'attention',
      searchUrl: engine === 'saucenao' ? '' : page.url,
      note:
        engine === 'google' && String(page.url).includes('consent.google.com')
          ? 'Google 先返回了 Cookie 同意页。没有可安全拒绝的选项，本站不会代为接受，也没有取得匹配。'
          : engine === 'google' && input.file && new URL(page.url).hostname === 'www.google.com'
            ? '图片已上传到 Google，但结果页要求浏览器执行 JavaScript 或完成验证。本站未取得匹配结果，可打开本次检索继续，无需重新选图。'
            : '原站要求浏览器验证，本站未取得匹配结果。请打开检索页继续；不会自动处理验证码。',
    };
  }
  if (page.status !== 200)
    throw new ApiError('此站检索失败（HTTP ' + page.status + '），不是已完成搜索。', 502);
  const parsed =
    engine === 'saucenao'
      ? parseSauceHtml(page.html)
      : engine === 'yandex'
        ? parseYandexHtml(page.html)
        : parseGoogleHtml(page.html);
  if (!parsed.recognized)
    return {
      results: [],
      status: 'attention',
      searchUrl: engine === 'saucenao' ? '' : page.url,
      note: '原站返回页面结构已变化或要求浏览器处理，当前无法解析图片结果。请打开本次检索查看。',
    };
  return {
    results: parsed.results,
    searchUrl: engine === 'saucenao' ? '' : page.url,
    note: '由原站网页实时提取，非官方 API；原站改版或限流可能导致暂时不可用。',
  };
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function blockedPage(page) {
  return (
    page.status === 403 ||
    /just a moment|cf-browser-verification|challenge-platform|id="captcha/i.test(
      String(page.html || '').slice(0, 80_000),
    )
  );
}

export function parseAscii2dHtml(html) {
  const $ = load(html),
    results = [],
    seen = new Set();
  $('.item-box').each((_, node) => {
    const box = $(node);
    const links = box
      .find('.detail-box a')
      .toArray()
      .map((anchor) => ({
        url: safeLink($(anchor).attr('href')),
        title: clean($(anchor).text()),
      }))
      .filter((link) => link.url);
    const work = links.at(-1);
    if (!work || seen.has(work.url)) return;
    seen.add(work.url);
    const author = links.length > 1 ? links[0].title : '';
    const source = clean(box.find('.detail-box small').first().text());
    const img = box.find('img').first();
    results.push({
      title: work.title || '图片来源',
      subtitle: [source, author].filter(Boolean).join(' · ') || new URL(work.url).hostname,
      url: work.url,
      thumbnail: imageLink(img.attr('src'), 'https://ascii2d.net/'),
      similarity: null,
      scoreLabel: 'ascii2d',
      thumbnailKind: '匹配图片',
    });
  });
  return { results: results.slice(0, 6), recognized: $('.item-box').length > 0 };
}

export async function searchAscii2d(input, fetcher, signal) {
  const headers = {
    Accept: 'text/html',
    'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
    'User-Agent': BROWSER_UA,
    Origin: 'https://ascii2d.net',
    Referer: 'https://ascii2d.net/',
  };
  if (input.url && !input.file) {
    const target = 'https://ascii2d.net/search/url/' + input.url;
    const page = await fetchPage(fetcher, target, { method: 'GET', headers }, signal, [
      'ascii2d.net',
    ]);
    return finishAscii2d(page, target);
  }
  // 原站是 Rails 表单，上传必须带首页下发的 authenticity_token 和同一次会话 Cookie。
  const home = await fetchPage(
    fetcher,
    'https://ascii2d.net/',
    { method: 'GET', headers },
    signal,
    ['ascii2d.net'],
  );
  const token = home.html.match(/name="authenticity_token" value="([^"]+)"/)?.[1] || '';
  const cookie = (home.cookies || []).map((item) => item.name + '=' + item.value).join('; ');
  const form = new FormData();
  form.set('utf8', '✓');
  if (token) form.set('authenticity_token', token);
  if (input.file) form.set('file', input.file, 'image.jpg');
  else form.set('uri', input.url);
  const postHeaders = new Headers(headers);
  if (cookie) postHeaders.set('Cookie', cookie);
  const page = await fetchPage(
    fetcher,
    input.file ? 'https://ascii2d.net/search/file' : 'https://ascii2d.net/search/uri',
    { method: 'POST', body: form, headers: postHeaders },
    signal,
    ['ascii2d.net'],
  );
  if (blockedPage(page) || page.status === 599)
    return {
      results: [],
      status: 'attention',
      searchUrl: input.url ? 'https://ascii2d.net/search/url/' + input.url : 'https://ascii2d.net/',
      note: 'ascii2d 要求浏览器验证，本站未读回匹配。已用带图片链接的地址打开；不会自动处理验证。',
    };
  return finishAscii2d(page, page.url);
}

function finishAscii2d(page, searchUrl) {
  if (blockedPage(page) || page.status === 599)
    return {
      results: [],
      status: 'attention',
      searchUrl,
      note: 'ascii2d 要求浏览器验证，本站未读回匹配。已用带图片链接的地址打开；不会自动处理验证。',
    };
  if (page.status !== 200)
    throw new ApiError('ascii2d 检索失败（HTTP ' + page.status + '），不是已完成搜索。', 502);
  const parsed = parseAscii2dHtml(page.html);
  if (!parsed.recognized)
    return {
      results: [],
      status: 'attention',
      searchUrl,
      note: 'ascii2d 页面没有可解析的结果。可以打开带图片链接的地址继续看。',
    };
  return { results: parsed.results, searchUrl, note: '由 ascii2d 检索页提取，非官方 API。' };
}

export function parseIqdbHtml(html) {
  const $ = load(html),
    results = [],
    seen = new Set();
  $('#pages table').each((_, table) => {
    const box = $(table);
    const anchor = box
      .find('a[href]')
      .toArray()
      .map((node) => {
        let href = $(node).attr('href') || '';
        if (href.startsWith('//')) href = 'https:' + href;
        return {
          url: safeLink(href),
          title: clean($(node).text()) || clean($(node).find('img').attr('alt')),
        };
      })
      .find((link) => link.url && !/iqdb\.org/i.test(link.url));
    if (!anchor || seen.has(anchor.url)) return;
    seen.add(anchor.url);
    const text = clean(box.text());
    const similarity = Number.parseFloat((text.match(/(\d{1,3})%\s*similarity/i) || [])[1]);
    let thumb = box.find('img').first().attr('src') || '';
    if (thumb.startsWith('//')) thumb = 'https:' + thumb;
    results.push({
      title: anchor.title || clean(box.find('th').first().text()) || 'IQDB 匹配',
      subtitle: clean(box.find('th').first().text()) || new URL(anchor.url).hostname,
      url: anchor.url,
      thumbnail: imageLink(thumb, 'https://iqdb.org/'),
      similarity: Number.isFinite(similarity) ? similarity : null,
      thumbnailKind: '匹配图片',
    });
  });
  const noRelevant = /No relevant matches/i.test($.text());
  return {
    results: results.slice(0, 6),
    recognized: results.length > 0 || noRelevant || $('#pages').length > 0,
  };
}

export async function searchIqdb(input, fetcher, signal) {
  if (!input.url) throw new ApiError('IQDB 需要公开的 HTTPS 图片链接。', 422);
  const target = 'https://iqdb.org/?url=' + encodeURIComponent(input.url);
  const page = await fetchPage(
    fetcher,
    target,
    {
      method: 'GET',
      headers: {
        Accept: 'text/html',
        'Accept-Language': 'en,zh-CN;q=0.8',
        'User-Agent': BROWSER_UA,
        Referer: 'https://iqdb.org/',
      },
    },
    signal,
    ['iqdb.org', 'www.iqdb.org'],
  );
  if (blockedPage(page) || page.status === 599)
    return {
      results: [],
      status: 'attention',
      searchUrl: target,
      note: 'IQDB 要求浏览器验证，本站未读回匹配。已用带图片链接的地址打开。',
    };
  if (page.status !== 200)
    throw new ApiError('IQDB 检索失败（HTTP ' + page.status + '），不是已完成搜索。', 502);
  const parsed = parseIqdbHtml(page.html);
  if (!parsed.recognized)
    return {
      results: [],
      status: 'attention',
      searchUrl: target,
      note: 'IQDB 页面没有可解析的结果。可以打开带图片链接的地址继续看。',
    };
  return {
    results: parsed.results,
    searchUrl: target,
    note: parsed.results.length
      ? '由 IQDB 按图片链接提取，非官方 API。'
      : 'IQDB 没有找到相关匹配。',
  };
}

function addBaiduResult(results, seen, title, url, thumbnail) {
  const link = safeLink(
    String(url || '')
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/'),
  );
  const image = String(thumbnail || '').replace(/\\\//g, '/');
  if (!link || seen.has(link) || /home-pc/i.test(image) || /\/duty\//.test(link)) return;
  seen.add(link);
  results.push({
    title:
      clean(
        String(title || '').replace(/\\u([0-9a-f]{4})/gi, (_, hex) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        ),
      ) || new URL(link).hostname,
    subtitle: new URL(link).hostname.replace(/^www\./, ''),
    url: link,
    thumbnail: imageLink(image, 'https://image.baidu.com/'),
    similarity: null,
    scoreLabel: '百度识图',
    thumbnailKind: '匹配图片',
  });
}

export function parseBaiduPayload(payload) {
  const results = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (!Array.isArray(node)) {
      const url = node.fromurl || node.fromUrl || node.objURL || node.objurl;
      const title = node.title || node.fromTitle || node.alt;
      const thumbnail = node.thumburl || node.thumbURL || node.hoverURL || node.img || node.image;
      if (typeof url === 'string' && /^https?:\/\//i.test(url) && typeof title === 'string')
        addBaiduResult(results, seen, title, url, thumbnail);
    }
    for (const value of Object.values(node)) walk(value);
  };
  if (typeof payload === 'string') {
    if (/cardName":"index"/.test(payload) && !/"(?:fromurl|fromUrl|objURL)"/.test(payload))
      return { results: [], recognized: false };
    const trimmed = payload.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        walk(JSON.parse(trimmed));
      } catch {
        /* 整页不是 JSON 时再拆内嵌片段。 */
      }
    }
    for (const match of payload.matchAll(
      /\{[\s\S]{0,5000}?"(?:fromurl|fromUrl|objURL)"[\s\S]{0,2000}?\}/g,
    )) {
      try {
        walk(JSON.parse(match[0].replace(/\\\//g, '/')));
      } catch {
        /* 某一段内嵌数据不可解析时继续。 */
      }
    }
  } else walk(payload);
  return { results: results.slice(0, 6), recognized: results.length > 0 };
}

export async function searchBaidu(input, fetcher, signal) {
  if (!input.file && input.url) return searchBaiduByUrl(input.url, fetcher, signal);
  if (!input.file) throw new ApiError('百度识图需要上传图片，或提供公开的 HTTPS 图片链接。', 422);
  const form = new FormData();
  form.set('image', input.file, 'image.jpg');
  form.set('from', 'pc');
  form.set('tn', 'pc');
  form.set('image_source', 'PC_UPLOAD_IMAGE_MOVE');
  form.set('range', '{"page_from":"searchIndex"}');
  form.set('uptime', String(Date.now()));
  const page = await fetchPage(
    fetcher,
    'https://image.baidu.com/pcdutu/a_upload?fr=html5&target=pcSearchImage&needJson=true',
    {
      method: 'POST',
      body: form,
      headers: {
        Accept: 'text/html,application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': BROWSER_UA,
        Origin: 'https://image.baidu.com',
        Referer: 'https://image.baidu.com/',
      },
    },
    signal,
    ['image.baidu.com', 'graph.baidu.com', 'www.baidu.com', 'shitu.baidu.com'],
  );
  let payload = page.html;
  try {
    const data = JSON.parse(page.html);
    const sign = String(data?.data?.sign || '');
    if (data?.status === 0 && /^[A-Za-z0-9_-]{8,128}$/.test(sign)) {
      const simi = await fetchPage(
        fetcher,
        'https://graph.baidu.com/ajax/pcsimi?entrance=GENERAL&tpl_from=pc&limit=6&sign=' + sign,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Referer: 'https://graph.baidu.com/',
            'User-Agent': BROWSER_UA,
          },
        },
        signal,
        ['graph.baidu.com'],
      );
      payload = simi.html;
    }
  } catch {
    /* 结果页不是 JSON 时按 HTML 解析。 */
  }
  if (blockedPage(page))
    return {
      results: [],
      status: 'attention',
      searchUrl: 'https://image.baidu.com/',
      note: '百度识图要求浏览器验证，本站未读回匹配。已尝试用你的浏览器打开；不会自动处理验证。',
    };
  const parsed = parseBaiduPayload(payload);
  if (!parsed.recognized)
    return {
      results: [],
      status: 'attention',
      searchUrl: 'https://image.baidu.com/',
      note: '百度识图没有返回可展示的相似图。已尝试用你的浏览器打开原站。',
    };
  return {
    results: parsed.results,
    searchUrl: page.url?.includes('baidu.com') ? page.url : 'https://image.baidu.com/',
    note: '由百度识图结果提取，非官方 API。',
  };
}

export function baiduDetailsUrl(imageUrl) {
  const url = new URL('https://graph.baidu.com/details');
  url.searchParams.set('isfromtusoupc', '1');
  url.searchParams.set('tn', 'pc');
  url.searchParams.set('carousel', '0');
  url.searchParams.set('promotion_name', 'pc_image_shituindex');
  url.searchParams.set('extUiData[isLogoShow]', '1');
  url.searchParams.set('image', imageUrl);
  return url.href;
}

async function searchBaiduByUrl(imageUrl, fetcher, signal) {
  const target = baiduDetailsUrl(imageUrl);
  const page = await fetchPage(
    fetcher,
    target,
    {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': BROWSER_UA,
        Referer: 'https://image.baidu.com/',
      },
    },
    signal,
    ['graph.baidu.com'],
  );
  const parsed = parseBaiduPayload(page.html);
  if (parsed.recognized)
    return {
      results: parsed.results,
      searchUrl: target,
      note: '由百度识图按图片链接提取，非官方 API。',
    };
  if (String(page.html || '').includes('未找到相关结果'))
    return {
      results: [],
      searchUrl: target,
      note: '百度识图已根据这个图片链接检索，没有返回相似图。',
    };
  if (blockedPage(page))
    return {
      results: [],
      status: 'attention',
      searchUrl: target,
      note: '百度识图要求浏览器验证，本站未读回匹配。可以打开本次链接继续；不会自动处理验证。',
    };
  return {
    results: [],
    status: 'attention',
    searchUrl: target,
    note: '百度识图没有返回可展示的相似图。可以打开本次链接查看。',
  };
}

export function normalizeBot(data) {
  if (!Array.isArray(data.results)) throw new ApiError('搜图 Bot 酱返回格式已变化。', 502);
  const results = [];
  for (const hit of data.results) {
    for (const segment of hit.path_segments || []) {
      const metadata = segment.metadata || {},
        url = safeLink(segment.page_url || segment.source_url || metadata.source?.url);
      if (!url) continue;
      const score = Number(hit.score);
      results.push({
        title: clean(metadata.title?.primary) || '图片出处',
        subtitle: clean(
          [metadata.source?.name, ...(metadata.creators || []).map((c) => c.name)]
            .filter(Boolean)
            .join(' · '),
        ),
        url,
        thumbnail: safeLink(segment.thumbnail_url),
        similarity: null,
        thumbnailKind: '匹配图片',
        sensitive: true,
        scoreLabel: Number.isFinite(score)
          ? '特征分 ' + score.toFixed(1) + (score < 45 ? ' · 低置信度' : '')
          : '局部图像候选',
      });
      if (results.length === 6) return results;
    }
  }
  return results;
}

export async function searchBot(input, fetcher, signal) {
  if (!input.file)
    throw new ApiError('搜图 Bot 酱接口只接受文件。请改用上传、拖拽或粘贴图片后搜索。', 422);
  const form = imageForm(input);
  form.set('factor', '1.2');
  form.set('metadata_mode', 'display');
  form.set('top_k', '6');
  const data = await upstreamJson(
    fetcher,
    'https://soutubot.moe/api/search',
    {
      method: 'POST',
      body: form,
      headers: { Accept: 'application/json', 'Accept-Language': 'zh-CN' },
    },
    signal,
  );
  const results = normalizeBot(data);
  return {
    results,
    searchUrl:
      typeof data.result_id === 'string'
        ? 'https://soutubot.moe/results/' + encodeURIComponent(data.result_id)
        : '',
    note:
      '图库可能含成人内容，缩略图默认隐藏。特征分不是百分比，低分结果通常不准确。' +
      (data.partial ? ' 部分图库未完成搜索。' : ''),
  };
}

const coverCache = new Map();
const normalizedTitle = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s/g, '');
export async function enrichAnimeCovers(results, fetcher, parentSignal) {
  const titles = [...new Set(results.map((r) => r.title))],
    covers = new Map();
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(8000)]);
  await Promise.all(
    titles.map(async (title) => {
      const cached = coverCache.get(title);
      if (cached && cached.expires > Date.now()) {
        covers.set(title, cached.value);
        return;
      }
      let value;
      try {
        const data = await upstreamJson(
          fetcher,
          'https://graphql.anilist.co',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query:
                'query ($search:String!) { Page(perPage:5) { media(search:$search,type:ANIME,isAdult:false) { id title { native romaji english } coverImage { medium } } } }',
              variables: { search: title },
            }),
          },
          signal,
        );
        const subject = data.data?.Page?.media?.find((s) =>
          Object.values(s.title || {}).some((n) => normalizedTitle(n) === normalizedTitle(title)),
        );
        if (subject && Number.isInteger(subject.id) && safeLink(subject.coverImage?.medium))
          value = {
            thumbnail: safeLink(subject.coverImage.medium),
            url: 'https://anilist.co/anime/' + subject.id,
            thumbnailKind: '作品封面 · AniList',
          };
      } catch {
        /* 封面服务失败不影响识别结果。 */
      }
      if (!value && !signal.aborted) {
        try {
          const data = await upstreamJson(
            fetcher,
            'https://api.bgm.tv/v0/search/subjects?limit=5',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'AllTrace/1.1 (reverse-image-search)',
              },
              body: JSON.stringify({ keyword: title, filter: { nsfw: false } }),
            },
            signal,
          );
          const subject = data.data?.find(
            (s) =>
              !s.nsfw &&
              [s.name, s.name_cn].some((n) => normalizedTitle(n) === normalizedTitle(title)),
          );
          if (
            subject &&
            Number.isInteger(subject.id) &&
            safeLink(subject.images?.common || subject.image)
          )
            value = {
              thumbnail: safeLink(subject.images?.common || subject.image),
              url: 'https://bgm.tv/subject/' + subject.id,
              displayTitle: subject.name_cn || title,
              thumbnailKind: '作品封面 · Bangumi',
            };
        } catch {
          /* Galgame 等 AniList 未覆盖的作品尝试备用元数据源。 */
        }
      }
      if (value) {
        if (coverCache.size >= 200) coverCache.delete(coverCache.keys().next().value);
        coverCache.set(title, { value, expires: Date.now() + 3600000 });
        covers.set(title, value);
      }
    }),
  );
  return results.map((result) =>
    covers.has(result.title)
      ? { ...result, ...covers.get(result.title), scoreLabel: '角色候选 · 封面非匹配截图' }
      : { ...result, thumbnailKind: '无作品封面', scoreLabel: '角色候选 · 封面暂缺' },
  );
}
