import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { engines, showsInResultGrid, usesBrowserSearch } from '../src/engines.ts';

// 仅替换 Hook 的宿主和浏览器边界，实际请求编排执行 src/useSearch.ts，避免消耗上游额度。
const searchModule = new URL('../src/useSearch.ts', import.meta.url).href;
const hookModule =
  'data:text/javascript,' +
  encodeURIComponent(
    ['useState', 'useRef', 'useEffect']
      .map(
        (name) =>
          `export const ${name} = (...args) => globalThis.__alltraceTestHooks.${name}(...args);`,
      )
      .join('\n'),
  );
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === searchModule && specifier === 'react')
      return { url: hookModule, shortCircuit: true };
    if (context.parentURL === searchModule && specifier === './engines')
      return { url: new URL('../src/engines.ts', import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { useSearch } = await import(searchModule);
loader.deregister();

function harness(t, options = {}) {
  const storage = options.storage || new Map();
  const calls = [],
    popups = [],
    cells = [];
  let cursor = 0,
    effects = [],
    current;
  const globals = {
    __alltraceTestHooks: {
      useState(initial) {
        const index = cursor++;
        if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial;
        return [
          cells[index],
          (value) => {
            cells[index] = typeof value === 'function' ? value(cells[index]) : value;
          },
        ];
      },
      useRef(initial) {
        const index = cursor++;
        return (cells[index] ??= { current: initial });
      },
      useEffect(effect, deps) {
        const index = cursor++;
        const previous = cells[index];
        if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
        effects.push(() => {
          previous?.cleanup?.();
          cells[index] = { deps, cleanup: effect() };
        });
      },
    },
    localStorage: {
      getItem(key) {
        if (options.storageFails) throw new Error('storage unavailable');
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (options.storageFails) throw new Error('storage unavailable');
        storage.set(key, value);
      },
    },
    window: {
      matchMedia(query) {
        return { matches: Boolean(options.mobile), media: query };
      },
      open() {
        if (options.blockPopup) return null;
        const popup = {
          closed: false,
          opener: {},
          location: {
            replace(href) {
              popup.href = href;
            },
          },
          close() {
            popup.closed = true;
          },
        };
        popups.push(popup);
        return popup;
      },
    },
    document: {
      addEventListener() {},
      removeEventListener() {},
      createElement() {
        return {
          getContext: () => ({ fillRect() {}, drawImage() {} }),
          toBlob: (callback) => callback(new Blob(['test image'], { type: 'image/jpeg' })),
        };
      },
    },
    createImageBitmap: async () => ({ width: 10, height: 10, close() {} }),
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (url === '/api/config') return Response.json({ engines: { trace: true }, modes: {} });
      if (url === '/api/temp-image')
        return options.tempResponse
          ? options.tempResponse()
          : Response.json({ url: 'https://alltrace.test/image.jpg' });
      return Response.json({ results: [] });
    },
  };
  const descriptors = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => {
    cells.forEach((cell) => cell?.cleanup?.());
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const render = () => {
    cursor = 0;
    effects = [];
    current = useSearch();
    effects.forEach((effect) => effect());
    return current;
  };
  render();
  return {
    storage,
    calls,
    popups,
    render,
    get current() {
      return current;
    },
    async settle() {
      await setImmediate();
      return render();
    },
    urlSearch(ids) {
      current.setInputMode('url');
      current.setUrlValue('https://example.com/image.jpg?x=1&y=2');
      current.setSelected(ids);
      render().beginSearch();
    },
  };
}

test('图片链接按能力分流，支持链接的内置引擎不受影响', () => {
  for (const id of ['trace', 'animetrace', 'saucenao', 'yandex', 'soutubot'])
    assert.equal(usesBrowserSearch(id, 'url'), false, id);
  for (const id of ['google', 'ascii2d', 'iqdb', 'baidu'])
    assert.equal(usesBrowserSearch(id, 'url'), true, id);
  assert.equal(usesBrowserSearch('saucenao', 'file', true), true);
});

test('浏览器方式在加载、完成和失败时均不显示内置卡片，切换偏好不改变旧结果', () => {
  for (const status of ['idle', 'loading', 'success', 'attention', 'error', 'skipped'])
    assert.equal(showsInResultGrid('soutubot', { status, mode: 'browser' }, false, 'file'), false);
  assert.equal(showsInResultGrid('soutubot', { status: 'idle' }, false, 'url'), true);
  assert.equal(showsInResultGrid('saucenao', { status: 'success', mode: 'inline' }, true), true);
});

test('外部搜索引擎默认关闭，仅勾选当前可用的内置引擎', (t) => {
  const h = harness(t);
  const inline = ['trace', 'saucenao', 'animetrace', 'yandex', 'soutubot'];
  assert.equal(h.current.browserEnabled, false);
  assert.deepEqual(h.current.selected, inline);
  assert.deepEqual(h.current.availableEngineIds, inline);
});

test('链接模式对五个内置引擎发请求，外部引擎不再重复内置检索', async (t) => {
  const h = harness(t, { storage: new Map([['alltrace-browser-enabled', 'true']]) });
  h.urlSearch(engines.map((engine) => engine.id));
  await h.settle();
  assert.deepEqual(
    h.calls
      .filter((call) => call.url.startsWith('/api/search/'))
      .map((call) => call.url)
      .sort(),
    [
      '/api/search/animetrace',
      '/api/search/saucenao',
      '/api/search/soutubot',
      '/api/search/trace',
      '/api/search/yandex',
    ],
  );
  assert.equal(h.popups.length, 4);
  assert.equal(
    h.calls.some((call) => call.url === '/api/temp-image'),
    false,
  );
  assert.equal(h.current.states.soutubot.status, 'success');
  assert.equal(h.current.completed, 9);
  assert.equal(h.current.activeCount, 9);
  assert.ok(h.popups.every((popup) => popup.href && popup.opener === null));
});

test('移动端只自动打开首个外部引擎，其余保留手动入口', async (t) => {
  const h = harness(t, {
    mobile: true,
    storage: new Map([['alltrace-browser-enabled', 'true']]),
  });
  h.urlSearch(['google', 'ascii2d', 'iqdb', 'baidu']);
  await h.settle();
  assert.equal(h.popups.length, 1);
  assert.equal(h.current.states.google.status, 'attention');
  assert.equal(h.current.states.google.manualOpen, undefined);
  for (const id of ['ascii2d', 'iqdb', 'baidu']) {
    const state = h.current.states[id];
    assert.equal(state.status, 'attention', id);
    assert.equal(state.manualOpen, true, id);
    assert.match(state.searchUrl, /^https:\/\//, id);
  }
});

test('关闭总开关取消纯外部勾选并保存，重新开启自动勾回', (t) => {
  const h = harness(t, { storage: new Map([['alltrace-browser-enabled', 'true']]) });
  const inline = ['trace', 'saucenao', 'animetrace', 'yandex', 'soutubot'];
  h.current.setBrowserEnabled(false);
  h.render();
  assert.deepEqual(h.current.selected, inline);
  assert.deepEqual(h.current.availableEngineIds, inline);
  assert.deepEqual(JSON.parse(h.storage.get('alltrace-selected-engines')), inline);
  h.current.setBrowserEnabled(true);
  h.render();
  assert.deepEqual([...h.current.selected].sort(), engines.map((engine) => engine.id).sort());
  assert.equal(h.current.availableEngineIds.length, engines.length);
});

test('重新开启只勾回关闭前已选择的外部搜索引擎', (t) => {
  const h = harness(t, { storage: new Map([['alltrace-browser-enabled', 'true']]) });
  h.current.setSelected(['trace', 'google', 'iqdb', 'soutubot']);
  h.render();
  h.current.setBrowserEnabled(false);
  h.render();
  assert.deepEqual(h.current.selected, ['trace', 'soutubot']);
  h.current.setBrowserEnabled(true);
  h.render();
  assert.deepEqual(h.current.selected, ['trace', 'soutubot', 'google', 'iqdb']);
});

test('读取关闭状态且没有恢复记录时，重新开启会勾选当前全部外部搜索引擎', (t) => {
  const h = harness(t, {
    storage: new Map([
      ['alltrace-browser-enabled', 'false'],
      ['alltrace-selected-engines', JSON.stringify(['trace'])],
    ]),
  });
  h.current.setBrowserEnabled(true);
  h.render();
  assert.deepEqual(h.current.selected, ['trace', 'google', 'ascii2d', 'iqdb', 'baidu']);
});

test('总开关关闭时，普通勾选和全选都无法重新选上外部搜索引擎', (t) => {
  const h = harness(t, { storage: new Map([['alltrace-browser-enabled', 'true']]) });
  h.current.setBrowserEnabled(false);
  h.current.setSelected(['trace']);
  h.render();
  h.current.setSelected((previous) => [...previous, 'google', 'ascii2d', 'baidu', 'iqdb']);
  h.render();
  assert.deepEqual(h.current.selected, ['trace']);
  h.current.setSelected(engines.map((engine) => engine.id));
  h.render();
  assert.deepEqual(h.current.selected, h.current.availableEngineIds);
  assert.equal(h.current.selected.length, 5);
  h.current.setSelected([]);
  h.render();
  assert.deepEqual(h.current.selected, []);
});

test('关闭总开关时 Bot 酱链接模式仍走内置检索，SauceNAO 外部偏好受限', (t) => {
  const h = harness(t, { storage: new Map([['alltrace-browser-enabled', 'true']]) });
  h.current.setBrowserEnabled(false);
  h.render();
  assert.ok(h.current.selected.includes('soutubot'));
  assert.ok(h.current.selected.includes('saucenao'));
  h.current.setInputMode('url');
  h.render();
  assert.ok(h.current.selected.includes('soutubot'));
  assert.ok(h.current.availableEngineIds.includes('soutubot'));
  h.current.setSauceBrowser(true);
  h.render();
  assert.deepEqual(h.current.selected, ['trace', 'animetrace', 'yandex', 'soutubot']);
  assert.equal(h.current.availableEngineIds.includes('saucenao'), false);
  h.current.setInputMode('file');
  h.current.setSauceBrowser(false);
  h.render();
  assert.ok(h.current.availableEngineIds.includes('soutubot'));
  assert.ok(h.current.availableEngineIds.includes('saucenao'));
  assert.deepEqual(h.current.selected, ['trace', 'animetrace', 'yandex', 'soutubot']);
});

test('读取旧存储时立即清除与关闭总开关冲突的勾选，保留 SauceNAO 独立偏好', (t) => {
  const h = harness(t, {
    storage: new Map([
      ['alltrace-browser-enabled', 'false'],
      ['alltrace-sauce-browser', 'true'],
      ['alltrace-selected-engines', JSON.stringify(engines.map((engine) => engine.id))],
    ]),
  });
  const inline = ['trace', 'animetrace', 'yandex', 'soutubot'];
  assert.deepEqual(h.current.selected, inline);
  assert.deepEqual(JSON.parse(h.storage.get('alltrace-selected-engines')), inline);
  assert.equal(h.current.sauceBrowser, true);
});

test('同一批次切换输入、偏好和全选也不能重新引入外部勾选', (t) => {
  const h = harness(t, { storage: new Map([['alltrace-browser-enabled', 'true']]) });
  h.current.setBrowserEnabled(false);
  h.current.setInputMode('url');
  h.current.setSauceBrowser(true);
  h.current.setSelected(engines.map((engine) => engine.id));
  h.render();
  assert.deepEqual(h.current.selected, ['trace', 'animetrace', 'yandex', 'soutubot']);
  assert.deepEqual(h.current.selected, h.current.availableEngineIds);
});

test('关闭总开关只请求内置引擎，包括链接模式的 Bot 酱', async (t) => {
  const h = harness(t, { storage: new Map([['alltrace-browser-enabled', 'true']]) });
  h.current.setBrowserEnabled(false);
  h.current.setSauceBrowser(true);
  h.render();
  h.urlSearch(engines.map((engine) => engine.id));
  await h.settle();
  assert.equal(h.popups.length, 0);
  assert.deepEqual(
    h.calls
      .filter((call) => call.url.startsWith('/api/search/'))
      .map((call) => call.url)
      .sort(),
    ['/api/search/animetrace', '/api/search/soutubot', '/api/search/trace', '/api/search/yandex'],
  );
  assert.equal(h.current.states.saucenao.status, 'skipped');
  assert.equal(h.current.states.soutubot.status, 'success');
  assert.equal(h.current.activeCount, 4);
  assert.equal(h.current.completed, 4);
  assert.equal(h.storage.get('alltrace-browser-enabled'), 'false');
  assert.equal(h.storage.get('alltrace-sauce-browser'), 'true');
});

test('关闭总开关且仅选外部引擎时，不请求、不弹窗并明确提示', async (t) => {
  const h = harness(t, { storage: new Map([['alltrace-browser-enabled', 'false']]) });
  h.urlSearch(['google', 'baidu']);
  await h.settle();
  assert.match(h.current.error, /总开关/);
  assert.equal(h.popups.length, 0);
  assert.ok(h.calls.every((call) => call.url === '/api/config'));
});

test('总开关和 SauceNAO 偏好从存储恢复，重新开启总开关不丢独立偏好', async (t) => {
  const h = harness(t, {
    storage: new Map([
      ['alltrace-browser-enabled', 'false'],
      ['alltrace-sauce-browser', 'true'],
    ]),
  });
  assert.equal(h.current.browserEnabled, false);
  assert.equal(h.current.sauceBrowser, true);
  h.current.setBrowserEnabled(true);
  h.render();
  h.urlSearch(['saucenao']);
  await h.settle();
  assert.equal(h.storage.get('alltrace-browser-enabled'), 'true');
  assert.equal(h.popups.length, 1);
  assert.ok(h.calls.every((call) => call.url === '/api/config'));
});

test('存储不可用时开关仍可使用，不阻断搜索', async (t) => {
  const h = harness(t, { storageFails: true });
  assert.equal(h.current.browserEnabled, false);
  h.current.setBrowserEnabled(true);
  h.render();
  assert.equal(h.current.browserEnabled, true);
  h.urlSearch(['trace']);
  await h.settle();
  assert.equal(h.current.states.trace.status, 'success');
  assert.equal(h.popups.length, 0);
});

test('弹窗被拦截时保留手动链接，不假装成功或发起内置请求', async (t) => {
  const h = harness(t, {
    blockPopup: true,
    storage: new Map([['alltrace-browser-enabled', 'true']]),
  });
  h.urlSearch(['iqdb']);
  await h.settle();
  const state = h.current.states.iqdb;
  assert.equal(state.status, 'error');
  assert.equal(state.mode, 'browser');
  assert.match(state.searchUrl, /^https:\/\/iqdb.org\/\?url=/);
  assert.equal(showsInResultGrid('iqdb', state), false);
  assert.ok(h.calls.every((call) => call.url === '/api/config'));
});

test('文件模式保留 Bot 酱内置上传，外部引擎只上传临时图片、不请求内置接口', async (t) => {
  const h = harness(t, { storage: new Map([['alltrace-browser-enabled', 'true']]) });
  await h.current.chooseFile(new File(['image'], 'sample.jpg', { type: 'image/jpeg' }));
  h.current.setSelected(['soutubot', 'google']);
  h.render().beginSearch();
  await h.settle();
  const botCall = h.calls.find((call) => call.url === '/api/search/soutubot');
  assert.ok(botCall.init.body instanceof FormData);
  assert.ok(botCall.init.body.get('image') instanceof File);
  assert.equal(h.calls.filter((call) => call.url === '/api/temp-image').length, 1);
  assert.equal(
    h.calls.some((call) => call.url === '/api/search/google'),
    false,
  );
  assert.equal(h.current.states.google.status, 'attention');
  assert.equal(h.current.states.soutubot.mode, 'inline');
});

test('取消期间完成的临时上传不能再跳转外站，预开的标签页会关闭', async (t) => {
  let resolve;
  const response = new Promise((done) => {
    resolve = done;
  });
  const h = harness(t, {
    tempResponse: () => response,
    storage: new Map([['alltrace-browser-enabled', 'true']]),
  });
  await h.current.chooseFile(new File(['image'], 'sample.jpg', { type: 'image/jpeg' }));
  h.current.setSelected(['google']);
  h.render().beginSearch();
  h.render().cancelSearch();
  resolve(Response.json({ url: 'https://alltrace.test/image.jpg' }));
  await h.settle();
  assert.equal(h.popups[0].closed, true);
  assert.equal(h.popups[0].href, undefined);
  assert.equal(h.current.states.google.status, 'idle');
});
