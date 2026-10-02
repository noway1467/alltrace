export type EngineId =
  | 'trace'
  | 'saucenao'
  | 'animetrace'
  | 'google'
  | 'yandex'
  | 'soutubot'
  | 'ascii2d'
  | 'baidu'
  | 'iqdb';
export type Category = 'all' | 'anime' | 'art' | 'web';
export type Result = {
  title: string;
  subtitle: string;
  similarity: number | null;
  thumbnail: string;
  url: string;
  displayTitle?: string;
  thumbnailKind?: string;
  sensitive?: boolean;
  scoreLabel?: string;
};
export type SearchState = {
  status: 'idle' | 'loading' | 'success' | 'error' | 'attention' | 'skipped';
  mode?: 'inline' | 'browser';
  manualOpen?: boolean;
  results?: Result[];
  error?: string;
  duration?: number;
  note?: string;
  searchUrl?: string;
};
export type SearchInput =
  { file: File; preview: string; width: number; height: number } | { url: string };
export const engines = [
  {
    id: 'trace',
    name: 'trace.moe',
    desc: '这一帧，来自哪一集？',
    detail: '动画场景 · 番剧集数 · 精确时间',
    category: 'anime',
    color: 'blue',
    url: 'https://trace.moe/',
    mode: 'API 直连',
  },
  {
    id: 'saucenao',
    name: 'SauceNAO',
    desc: '找到画师，也找到出处',
    detail: '插画出处 · Pixiv · 同人作品',
    category: 'art',
    color: 'rose',
    url: 'https://saucenao.com/',
    mode: 'API 直连',
  },
  {
    id: 'animetrace',
    name: 'AnimeTrace',
    desc: '和画面里的 TA 再次相遇',
    detail: '动漫角色 · Galgame · AI 识别',
    category: 'anime',
    color: 'violet',
    url: 'https://ai.animedb.cn/',
    mode: 'API 直连',
  },
  {
    id: 'google',
    name: 'Google Lens',
    desc: '在更大的世界里找找',
    detail: '全网图片 · 相似内容 · 网页来源',
    category: 'web',
    color: 'green',
    url: 'https://images.google.com/imghp?hl=zh-CN',
    mode: '你的浏览器',
  },
  {
    id: 'ascii2d',
    name: 'ascii2d',
    desc: '从二次元画面里找原图',
    detail: '颜色检索 · 插画 · 截图',
    category: 'art',
    color: 'teal',
    url: 'https://ascii2d.net/',
    mode: '网页检索',
  },
  {
    id: 'iqdb',
    name: 'IQDB',
    desc: '多站点一起对照',
    detail: 'Danbooru · Gelbooru · 插画',
    category: 'art',
    color: 'sand',
    url: 'https://iqdb.org/',
    mode: '图片链接',
  },
  {
    id: 'baidu',
    name: '百度识图',
    desc: '用中文互联网再看一眼',
    detail: '相似图片 · 网页来源 · 图片链接',
    category: 'web',
    color: 'azure',
    url: 'https://image.baidu.com/',
    mode: '图片链接',
  },
  {
    id: 'yandex',
    name: 'Yandex Images',
    desc: '换一个视角，发现更多',
    detail: '相似图片 · 高清原图 · 广域搜索',
    category: 'web',
    color: 'amber',
    url: 'https://yandex.ru/images/',
    mode: '网页检索',
  },
  {
    id: 'soutubot',
    name: '搜图 Bot 酱',
    desc: '让搜图酱帮你找一找',
    detail: 'ACG 图片 · 局部匹配 · 原图检索',
    category: 'art',
    color: 'pink',
    url: 'https://soutubot.moe/',
    mode: '网页接口 · 仅文件',
  },
] as const;
export type Engine = (typeof engines)[number];
export const initialStates = () =>
  Object.fromEntries(engines.map((e) => [e.id, { status: 'idle' }])) as Record<
    EngineId,
    SearchState
  >;
export const categories = [
  { id: 'all', label: '全部引擎' },
  { id: 'anime', label: '动画 / 角色' },
  { id: 'art', label: '插画 / 漫画' },
  { id: 'web', label: '全网搜索' },
] as const;
export function externalLink(engine: Engine, input: SearchInput | null) {
  if (!input || !('url' in input)) return engine.url;
  const linked = imageSearchUrl(engine.id, input.url);
  if (linked) return linked;
  const url = encodeURIComponent(input.url);
  if (engine.id === 'yandex') return 'https://yandex.ru/images/search?rpt=imageview&url=' + url;
  if (engine.id === 'trace' || engine.id === 'animetrace') return engine.url + '?url=' + url;
  return engine.url;
}

export function imageSearchUrl(id: EngineId, imageUrl: string) {
  const url = encodeURIComponent(imageUrl);
  if (id === 'google') return 'https://lens.google.com/uploadbyurl?url=' + url + '&hl=zh-CN';
  if (id === 'saucenao') return 'https://saucenao.com/search.php?url=' + url;
  if (id === 'ascii2d') return 'https://ascii2d.net/search/url/' + imageUrl;
  if (id === 'iqdb') return 'https://iqdb.org/?url=' + url;
  if (id === 'baidu')
    return (
      'https://graph.baidu.com/details?isfromtusoupc=1&tn=pc&carousel=0&promotion_name=pc_image_shituindex&extUiData%5BisLogoShow%5D=1&image=' +
      url
    );
  return '';
}

export const browserEngines = new Set<EngineId>(['google', 'baidu', 'ascii2d', 'iqdb']);

export function usesBrowserSearch(id: EngineId, inputMode: 'file' | 'url', sauceBrowser = false) {
  return (
    browserEngines.has(id) ||
    (id === 'saucenao' && sauceBrowser) ||
    (id === 'soutubot' && inputMode === 'url')
  );
}

export function showsInResultGrid(
  id: EngineId,
  state: SearchState | undefined,
  sauceBrowser = false,
  inputMode: 'file' | 'url' = 'file',
) {
  // 已发起的检索按当时的方式展示，避免切换输入或偏好后冒出外站占位卡片。
  if (state?.mode) return state.mode === 'inline';
  return !usesBrowserSearch(id, inputMode, sauceBrowser);
}
