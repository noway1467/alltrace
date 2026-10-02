import {
  ApiError,
  json,
  safeLink,
  readInput,
  imageForm,
  upstreamJson,
  MAX_IMAGE_BYTES,
} from './http.js';
import {
  searchWeb,
  searchBot,
  searchAscii2d,
  searchBaidu,
  searchIqdb,
  enrichAnimeCovers,
} from './providers.js';
import { renderGooglePage } from './google-browser.js';
import { publishTempImage, readTempImage } from './temp-image.js';
export { publicImageUrl, detectImage } from './http.js';
const DIRECT_ENGINES = [
  'trace',
  'animetrace',
  'saucenao',
  'soutubot',
  'yandex',
  'google',
  'ascii2d',
  'baidu',
  'iqdb',
];

function timecode(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
}

export function normalizeTrace(data) {
  return (Array.isArray(data.result) ? data.result : [])
    .filter((r) => !r.anilist?.isAdult)
    .slice(0, 6)
    .map((r) => ({
      title: r.anilist?.title?.native || r.anilist?.title?.romaji || r.filename || '未命名动画',
      subtitle: [
        r.episode != null ? `第 ${r.episode} 集` : '集数未知',
        `${timecode(r.from)} ~ ${timecode(r.to)}`,
      ].join(' · '),
      similarity:
        typeof r.similarity === 'number' ? Math.min(100, Math.max(0, r.similarity * 100)) : null,
      thumbnail: safeLink(r.image),
      url: Number.isInteger(r.anilist?.id)
        ? `https://anilist.co/anime/${r.anilist.id}`
        : 'https://trace.moe/',
    }));
}

export function normalizeAnimeTrace(data) {
  const entries = [];
  for (const box of Array.isArray(data.data) ? data.data : []) {
    for (const character of Array.isArray(box.character) ? box.character : []) {
      if (entries.some((r) => r.title === character.work && r.character === character.character))
        continue;
      entries.push({
        title: character.work || '作品未知',
        character: character.character || '',
        subtitle: `${character.character || '角色未知'}${box.not_confident ? ' · 待确认候选' : ''}`,
        similarity: null,
        thumbnail: '',
        url: `https://ai.animedb.cn/`,
      });
      if (entries.length >= 6) return entries;
    }
  }
  return entries;
}

export function normalizeSauce(data) {
  return (Array.isArray(data.results) ? data.results : [])
    .filter((r) => !Number(r.header?.hidden))
    .slice(0, 6)
    .map((r) => {
      const d = r.data || {};
      const score = Number(r.header?.similarity);
      return {
        title: d.title || d.eng_name || d.jp_name || d.source || '图片来源',
        subtitle: String(
          d.member_name || d.author_name || d.creator || r.header?.index_name || '来源匹配',
        ),
        similarity: Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : null,
        thumbnail: safeLink(r.header?.thumbnail),
        url:
          (Array.isArray(d.ext_urls) ? d.ext_urls : []).map(safeLink).find(Boolean) ||
          'https://saucenao.com/',
      };
    });
}

async function search(engine, input, env, fetcher) {
  // Google 可能要先上传，再等浏览器跑完脚本重试，35 秒不够，但仍要落在页面 45 秒取消之内。
  const signal = AbortSignal.timeout(engine === 'google' ? 42000 : 35000);
  if (engine === 'soutubot') return searchBot(input, fetcher, signal);
  if (engine === 'ascii2d') return searchAscii2d(input, fetcher, signal);
  if (engine === 'baidu') return searchBaidu(input, fetcher, signal);
  if (engine === 'iqdb') return searchIqdb(input, fetcher, signal);
  if (engine === 'yandex') return searchWeb(engine, input, fetcher, signal);
  if (engine === 'google')
    return searchWeb(engine, input, fetcher, signal, {
      renderPage: env.BROWSER
        ? (pageUrl, pageSignal, cookies) =>
            renderGooglePage(env.BROWSER, pageUrl, pageSignal, cookies)
        : null,
    });
  if (engine === 'trace') {
    const url = new URL('https://api.trace.moe/search');
    url.searchParams.set('anilistInfo', '');
    url.searchParams.set('cutBorders', '');
    const headers = env.TRACE_API_KEY ? { 'x-trace-key': env.TRACE_API_KEY } : {};
    let init = {
      method: 'POST',
      headers: { ...headers, 'Content-Type': input.file?.type || 'image/jpeg' },
      body: input.file,
    };
    if (input.url) {
      url.searchParams.set('url', input.url);
      init = { method: 'GET', headers };
    }
    const data = await upstreamJson(fetcher, url, init, signal);
    if (data.error) throw new ApiError('trace.moe 未能完成识别，请换一张完整动画截图重试。', 502);
    if (!Array.isArray(data.result)) throw new ApiError('trace.moe 返回格式异常。', 502);
    return { results: normalizeTrace(data) };
  }
  if (engine === 'animetrace') {
    // 按官方文档动态选择可用默认模型，避免模型下线后硬编码失效。
    const models = await upstreamJson(
      fetcher,
      'https://api.animetrace.com/v1/model/list',
      {},
      signal,
    );
    const available = Array.isArray(models.data) ? models.data.filter((m) => m.enabled) : [];
    const model = available.find((m) => m.default) || available[0];
    if (!model?.id) throw new ApiError('AnimeTrace 当前没有可用模型，请稍后重试。', 503);
    const form = imageForm(input);
    form.set('model', model.id);
    form.set('is_multi', '1');
    form.set('ai_detect', '1');
    const data = await upstreamJson(
      fetcher,
      'https://api.animetrace.com/v1/search',
      { method: 'POST', body: form },
      signal,
    );
    if (![0, 200, 17720].includes(Number(data.code)))
      throw new ApiError('AnimeTrace 暂时无法识别，请稍后重试或前往原站。', 502);
    if (!Array.isArray(data.data)) throw new ApiError('AnimeTrace 返回格式异常。', 502);
    return {
      results: await enrichAnimeCovers(normalizeAnimeTrace(data), fetcher, signal),
      note:
        'AnimeTrace 只返回角色与作品候选，不返回匹配截图。这里的图片由 AniList / Bangumi 按同名作品补充，是作品封面，不是相似图。' +
        (data.ai ? ' 此图可能由 AI 生成。' : ''),
    };
  }
  if (!env.SAUCENAO_API_KEY?.trim()) return searchWeb('saucenao', input, fetcher, signal);
  const form = imageForm(input);
  form.set('api_key', env.SAUCENAO_API_KEY.trim());
  form.set('output_type', '2');
  form.set('db', '999');
  form.set('numres', '6');
  form.set('hide', '3');
  const data = await upstreamJson(
    fetcher,
    'https://saucenao.com/search.php',
    { method: 'POST', body: form },
    signal,
  );
  if (Number(data.header?.status) < 0)
    throw new ApiError('SauceNAO 搜索失败，请检查 API Key 与剩余额度。', 502);
  if (!Array.isArray(data.results)) throw new ApiError('SauceNAO 返回格式异常。', 502);
  return { results: normalizeSauce(data) };
}

export async function handleApi(request, env = {}, fetcher = fetch) {
  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/config' && request.method === 'GET') {
      return json({
        engines: {
          trace: true,
          animetrace: true,
          saucenao: true,
          soutubot: true,
          yandex: true,
          google: true,
          ascii2d: true,
          baidu: true,
          iqdb: true,
        },
        modes: {
          trace: 'API 直连',
          animetrace: '角色 API + 作品封面',
          saucenao: env.SAUCENAO_API_KEY?.trim() ? 'API 直连' : '匿名网页检索',
          soutubot: '网页接口 · 支持链接',
          yandex: '网页检索',
          google: '你的浏览器',
          ascii2d: '网页检索',
          baidu: '图片链接',
          iqdb: '图片链接',
        },
        maxImageBytes: MAX_IMAGE_BYTES,
      });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/temp-image/'))
      return readTempImage(request, env);
    if (url.pathname === '/api/temp-image' && request.method === 'POST') {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) throw new ApiError('不允许跨站搜索请求。', 403);
      if (request.headers.get('sec-fetch-site') === 'cross-site')
        throw new ApiError('不允许跨站搜索请求。', 403);
      if (env.SEARCH_LIMITER) {
        const { success } = await env.SEARCH_LIMITER.limit({
          key: request.headers.get('CF-Connecting-IP') || 'local-development',
        });
        if (!success) throw new ApiError('请求有点频繁，请等一分钟再试。', 429);
      }
      const input = await readInput(request);
      return json({ url: await publishTempImage(request, input, env) });
    }
    const engine = url.pathname.match(/^\/api\/search\/([a-z0-9]+)$/)?.[1];
    if (!DIRECT_ENGINES.includes(engine)) return json({ error: '接口不存在。' }, 404);
    if (request.method !== 'POST') return json({ error: '请使用 POST 上传图片。' }, 405);
    // 仅开放本站 UI 请求；限流在读取文件之前执行，减少无效请求资源消耗。
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) throw new ApiError('不允许跨站搜索请求。', 403);
    if (request.headers.get('sec-fetch-site') === 'cross-site')
      throw new ApiError('不允许跨站搜索请求。', 403);
    if (env.SEARCH_LIMITER) {
      const { success } = await env.SEARCH_LIMITER.limit({
        key: request.headers.get('CF-Connecting-IP') || 'local-development',
      });
      if (!success) throw new ApiError('请求有点频繁，请等一分钟再试。', 429);
    }
    const input = await readInput(request);
    const started = Date.now();
    const result = await search(engine, input, env, fetcher);
    return json({ engine, ...result, duration: Date.now() - started });
  } catch (error) {
    return json(
      { error: error instanceof ApiError ? error.message : '搜索服务暂时不可用，请稍后重试。' },
      error instanceof ApiError ? error.status : 500,
    );
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
