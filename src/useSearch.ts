import { useEffect, useRef, useState } from 'react';
import {
  engines,
  imageSearchUrl,
  initialStates,
  usesBrowserSearch,
  type EngineId,
  type SearchInput,
  type SearchState,
} from './engines';

const selectedEnginesKey = 'alltrace-selected-engines';
const sauceBrowserKey = 'alltrace-sauce-browser';
const browserEnabledKey = 'alltrace-browser-enabled';

type SearchSelection = {
  inputMode: 'file' | 'url';
  selected: EngineId[];
  browserEnabled: boolean;
  sauceBrowser: boolean;
  restoreExternal?: EngineId[];
};

function normalizeSelection(selection: SearchSelection): SearchSelection {
  if (selection.browserEnabled) return selection;
  return {
    ...selection,
    selected: selection.selected.filter(
      (id) => !usesBrowserSearch(id, selection.inputMode, selection.sauceBrowser),
    ),
  };
}

function isMobilePopupLimited() {
  try {
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)').matches
    )
      return true;
    return typeof window.innerWidth === 'number' && window.innerWidth <= 767;
  } catch {
    return false;
  }
}

function loadSelectedEngines(): EngineId[] {
  const fallback = engines.map((engine) => engine.id);
  try {
    const raw = localStorage.getItem(selectedEnginesKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const known = new Set<EngineId>(fallback);
    const picked = parsed.filter(
      (id): id is EngineId => typeof id === 'string' && known.has(id as EngineId),
    );
    return picked;
  } catch {
    return fallback;
  }
}

async function publicImageAddress(input: SearchInput, signal: AbortSignal) {
  if (!('file' in input)) return input.url;
  const body = new FormData();
  body.set('image', input.file);
  const response = await fetch('/api/temp-image', { method: 'POST', body, signal });
  const data = await response.json();
  if (!response.ok || typeof data.url !== 'string' || !/^https?:\/\//.test(data.url))
    throw new Error(data.error || '无法生成带图片的检索链接。');
  return data.url;
}

export function useSearch() {
  const [selection, setSelection] = useState<SearchSelection>(() => {
    let browserEnabled = false;
    let sauceBrowser = false;
    try {
      browserEnabled = localStorage.getItem(browserEnabledKey) === 'true';
      sauceBrowser = localStorage.getItem(sauceBrowserKey) === 'true';
    } catch {
      /* 存储不可用时沿用默认偏好，仍允许本次交互。 */
    }
    return normalizeSelection({
      inputMode: 'file',
      selected: loadSelectedEngines(),
      browserEnabled,
      sauceBrowser,
    });
  });
  const { inputMode, selected, browserEnabled, sauceBrowser } = selection;
  const availableEngineIds = engines
    .filter((engine) => browserEnabled || !usesBrowserSearch(engine.id, inputMode, sauceBrowser))
    .map((engine) => engine.id);

  function updateSelection(patch: Partial<Omit<SearchSelection, 'selected'>>) {
    // 偏好与勾选一起更新，避免批量操作或切换输入模式时把外部引擎重新勾回。
    setSelection((previous) => normalizeSelection({ ...previous, ...patch }));
  }
  function setInputMode(inputMode: SearchSelection['inputMode']) {
    updateSelection({ inputMode });
  }
  function setBrowserEnabled(browserEnabled: boolean) {
    setSelection((previous) => {
      if (browserEnabled) {
        const candidates =
          previous.restoreExternal ??
          engines
            .filter((engine) =>
              usesBrowserSearch(engine.id, previous.inputMode, previous.sauceBrowser),
            )
            .map((engine) => engine.id);
        const compatible = candidates.filter((id) =>
          usesBrowserSearch(id, previous.inputMode, previous.sauceBrowser),
        );
        return normalizeSelection({
          ...previous,
          browserEnabled: true,
          selected: [...new Set([...previous.selected, ...compatible])],
          restoreExternal: undefined,
        });
      }
      const removed = previous.selected.filter((id) =>
        usesBrowserSearch(id, previous.inputMode, previous.sauceBrowser),
      );
      return normalizeSelection({
        ...previous,
        browserEnabled: false,
        restoreExternal: removed,
      });
    });
  }
  function setSauceBrowser(sauceBrowser: boolean) {
    updateSelection({ sauceBrowser });
  }
  function setSelected(value: EngineId[] | ((previous: EngineId[]) => EngineId[])) {
    setSelection((previous) =>
      normalizeSelection({
        ...previous,
        selected: typeof value === 'function' ? value(previous.selected) : value,
      }),
    );
  }
  const [image, setImage] = useState<Extract<SearchInput, { file: File }> | null>(null);
  const [urlValue, setUrlValue] = useState('');
  const [states, setStates] = useState(initialStates);
  const [config, setConfig] = useState<Record<string, boolean>>({
    trace: true,
    animetrace: true,
    saucenao: true,
  });
  const [modes, setModes] = useState<Record<string, string>>({});
  const [configStatus, setConfigStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeInput, setActiveInput] = useState<SearchInput | null>(null);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const controllers = useRef(new Set<AbortController>());
  const generation = useRef(0);
  const imageGeneration = useRef(0);
  useEffect(() => {
    try {
      localStorage.setItem(selectedEnginesKey, JSON.stringify(selected));
    } catch {
      /* 隐私模式不影响本次勾选。 */
    }
  }, [selected]);
  useEffect(() => {
    try {
      localStorage.setItem(sauceBrowserKey, String(sauceBrowser));
    } catch {
      /* 隐私模式不影响 SauceNAO 打开方式。 */
    }
  }, [sauceBrowser]);
  useEffect(() => {
    try {
      localStorage.setItem(browserEnabledKey, String(browserEnabled));
    } catch {
      /* 隐私模式不影响本次浏览器打开开关。 */
    }
  }, [browserEnabled]);
  const busy = Object.values(states).some((s) => s.status === 'loading');
  const hasSearched = Object.values(states).some((s) => s.status !== 'idle');
  const completed = Object.values(states).filter((s) =>
    ['success', 'error', 'attention'].includes(s.status),
  ).length;
  const activeCount = Object.values(states).filter((s) => s.mode && s.status !== 'skipped').length;
  const totalMatches = Object.values(states).reduce(
    (count, s) => count + (s.results?.length || 0),
    0,
  );
  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.preview);
    },
    [image],
  );
  useEffect(
    () => () => {
      controllers.current.forEach((c) => c.abort());
    },
    [],
  );

  async function loadConfig() {
    setConfigStatus('loading');
    try {
      const response = await fetch('/api/config', { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!data.engines || typeof data.engines.trace !== 'boolean') throw new Error();
      setConfig(data.engines);
      setModes(data.modes || {});
      setConfigStatus('ready');
    } catch {
      setConfigStatus('error');
    }
  }
  useEffect(() => {
    void loadConfig();
  }, []);
  function cancelSearch() {
    generation.current += 1;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setStates(initialStates());
    setActiveInput(null);
  }
  async function chooseFile(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('请选择 JPG、PNG、WebP 或 GIF 图片。');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('这张图片超过 8 MB，请压缩后再试。');
      return;
    }
    const token = ++imageGeneration.current;
    setPreparing(true);
    setError('');
    cancelSearch();
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 40_000_000) {
        bitmap.close();
        throw new Error('图片分辨率过高，请先缩小至 4000 万像素以内。');
      }
      const originalWidth = bitmap.width,
        originalHeight = bitmap.height;
      const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        bitmap.close();
        throw new Error('浏览器无法处理此图片，请换用较新的浏览器。');
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.9),
      );
      if (!blob) throw new Error('图片读取失败，请重新选择。');
      if (token !== imageGeneration.current) return;
      setImage({
        file: new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }),
        preview: URL.createObjectURL(blob),
        width: originalWidth,
        height: originalHeight,
      });
      setInputMode('file');
    } catch (e) {
      if (token === imageGeneration.current)
        setError(
          e instanceof Error && !(e instanceof DOMException) && !(e instanceof TypeError)
            ? e.message
            : '图片无法解码，请重新导出为 JPG 或 PNG 后再试。',
        );
    } finally {
      if (token === imageGeneration.current) setPreparing(false);
    }
  }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (
        document.querySelector('dialog[open]') ||
        (event.target instanceof Element &&
          event.target.closest('input, textarea, [contenteditable]'))
      )
        return;
      const file = Array.from(event.clipboardData?.items || [])
        .find((item) => item.type.startsWith('image/'))
        ?.getAsFile();
      if (file) {
        event.preventDefault();
        void chooseFile(file);
      }
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, []);
  async function runEngine(
    id: EngineId,
    input: SearchInput,
    token: number,
    popup: Window | null = null,
    viaBrowser = usesBrowserSearch(id, 'url' in input ? 'url' : 'file', sauceBrowser),
    openAutomatically = true,
  ) {
    const mode = viaBrowser ? 'browser' : 'inline';
    let searchUrl: string | undefined;
    const setState = (state: SearchState) => {
      if (generation.current === token)
        setStates((previous) => ({ ...previous, [id]: { ...state, mode } }));
    };
    setState({ status: 'loading' });
    const controller = new AbortController();
    controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort('timeout'), 45000);
    try {
      if (viaBrowser) {
        const imageUrl = await publicImageAddress(input, controller.signal);
        if (controller.signal.aborted || generation.current !== token) {
          popup?.close();
          return;
        }
        searchUrl = imageSearchUrl(id, imageUrl);
        if (!searchUrl) throw new Error('无法生成带图片的检索链接。');
        if (!openAutomatically) {
          setState({
            status: 'attention',
            results: [],
            note: '移动端浏览器限制连续打开标签页，请手动打开此引擎。',
            searchUrl,
            manualOpen: true,
          });
          return;
        }
        if (!popup || popup.closed)
          throw new Error('新标签页未打开，请点击下方链接，或允许弹出窗口后重试。');
        popup.opener = null;
        popup.location.replace(searchUrl);
        setState({
          status: 'attention',
          results: [],
          note: '已在浏览器新标签页检索，结果仅在原站显示。',
          searchUrl,
        });
        return;
      }
      let body: FormData | string;
      const headers: Record<string, string> = {};
      if ('file' in input) {
        body = new FormData();
        body.set('image', input.file);
        body.set('image_width', String(input.width));
        body.set('image_height', String(input.height));
      } else {
        body = JSON.stringify({ url: input.url });
        headers['Content-Type'] = 'application/json';
      }
      const response = await fetch('/api/search/' + id, {
        method: 'POST',
        body,
        headers,
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '搜索失败，请稍后重试。');
      if (!Array.isArray(data.results)) throw new Error('引擎返回格式异常，请稍后重试。');
      setState({
        status: data.status === 'attention' ? 'attention' : 'success',
        results: data.results,
        duration: data.duration,
        note: data.note,
        searchUrl: data.searchUrl,
      });
    } catch (e) {
      setState({
        status: 'error',
        searchUrl,
        error: controller.signal.aborted
          ? '搜索超时，请稍后重试或前往原站。'
          : e instanceof Error && !(e instanceof TypeError) && !(e instanceof SyntaxError)
            ? e.message
            : '网络连接失败，请稍后重试。',
      });
      popup?.close();
    } finally {
      clearTimeout(timeout);
      controllers.current.delete(controller);
    }
  }
  function beginSearch() {
    setError('');
    if (!selected.length) {
      setError(
        browserEnabled
          ? '至少选择一个搜索引擎吧。'
          : '请选择内置引擎，或开启外部搜索引擎总开关后选择引擎。',
      );
      return;
    }
    let input: SearchInput;
    if (inputMode === 'file') {
      if (!image) {
        setError('先选择一张想要寻找出处的图片吧。');
        return;
      }
      input = image;
    } else {
      try {
        const url = new URL(urlValue.trim());
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
        input = { url: url.href };
      } catch {
        setError('请输入公开可访问的 HTTPS 图片链接。');
        return;
      }
    }
    const eligible = selected.filter(
      (id) => browserEnabled || !usesBrowserSearch(id, inputMode, sauceBrowser),
    );
    if (!eligible.length) {
      setError('所选引擎均需浏览器打开，请开启外部搜索引擎总开关或选择内置引擎。');
      return;
    }
    cancelSearch();
    const token = generation.current;
    setActiveInput(input);
    setStates(
      Object.fromEntries(
        engines.map((e) => [
          e.id,
          {
            status: eligible.includes(e.id) ? 'idle' : 'skipped',
            mode: usesBrowserSearch(e.id, inputMode, sauceBrowser) ? 'browser' : 'inline',
          },
        ]),
      ) as Record<EngineId, SearchState>,
    );
    const browserIds = eligible.filter((id) => usesBrowserSearch(id, inputMode, sauceBrowser));
    const autoOpenIds = new Set(isMobilePopupLimited() ? browserIds.slice(0, 1) : browserIds);
    const tabs = new Map<EngineId, Window | null>();
    autoOpenIds.forEach((id) => tabs.set(id, window.open('about:blank', '_blank')));
    eligible.forEach(
      (id) =>
        void runEngine(
          id,
          input,
          token,
          tabs.get(id) ?? null,
          browserIds.includes(id),
          autoOpenIds.has(id),
        ),
    );
  }
  function clearImage() {
    imageGeneration.current += 1;
    setPreparing(false);
    cancelSearch();
    setImage(null);
    setUrlValue('');
    setError('');
  }
  function retry(id: EngineId) {
    if (!activeInput) return;
    const viaBrowser = states[id].mode === 'browser';
    if (viaBrowser && !browserEnabled) {
      setError('请先开启外部搜索引擎总开关，再重试浏览器检索。');
      return;
    }
    const popup = viaBrowser ? window.open('about:blank', '_blank') : null;
    void runEngine(id, activeInput, generation.current, popup, viaBrowser);
  }
  return {
    inputMode,
    setInputMode,
    image,
    urlValue,
    setUrlValue,
    selected,
    setSelected,
    availableEngineIds,
    states,
    sauceBrowser,
    setSauceBrowser,
    browserEnabled,
    setBrowserEnabled,
    config,
    modes,
    configStatus,
    activeInput,
    error,
    setError,
    preparing,
    busy,
    hasSearched,
    completed,
    activeCount,
    totalMatches,
    loadConfig,
    cancelSearch,
    chooseFile,
    beginSearch,
    clearImage,
    retry,
  };
}
