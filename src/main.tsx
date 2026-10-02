import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowClockwise,
  Check,
  CheckCircle,
  CircleNotch,
  Cloud,
  FilmStrip,
  Flower,
  Heart,
  Image as ImageIcon,
  Info,
  Eye,
  Link as LinkIcon,
  MagnifyingGlass,
  Moon,
  PaintBrush,
  Sparkle,
  Sun,
  Trash,
  UploadSimple,
  UserFocus,
  X,
} from '@phosphor-icons/react';
import { engines, categories, showsInResultGrid, type Category } from './engines';
import { EngineCard, EngineMark } from './EngineCard';
import { useSearch } from './useSearch';
import '@fontsource-variable/nunito-sans';
import './styles.css';

function App() {
  const search = useSearch();
  const {
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
  } = search;
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('alltrace-theme') || 'dark';
    } catch {
      return 'dark';
    }
  });
  const [category, setCategory] = useState<Category>('all');
  const [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<'about' | null>(null);
  const [showThumbnails, setShowThumbnails] = useState(() => {
    try {
      return localStorage.getItem('alltrace-sauce-bot-thumbnails') !== 'false';
    } catch {
      return true;
    }
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('alltrace-theme', theme);
    } catch {
      /* 隐私模式不影响主题切换。 */
    }
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem('alltrace-sauce-bot-thumbnails', String(showThumbnails));
    } catch {
      /* 隐私模式不影响缩略图开关。 */
    }
  }, [showThumbnails]);
  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialog]);
  const resultEngines = engines.filter((engine) =>
    showsInResultGrid(engine.id, states[engine.id], sauceBrowser, inputMode),
  );
  const openedCount = Object.values(states).filter(
    (state) => state.mode === 'browser' && state.status === 'attention' && !state.manualOpen,
  ).length;
  const manualBrowserEngines = engines.filter((engine) => {
    const state = states[engine.id];
    return state.mode === 'browser' && state.status === 'attention' && state.manualOpen;
  });
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="/" aria-label="AllTrace 寻迹首页">
            <span className="brand-symbol">
              <Flower size={26} weight="fill" />
            </span>
            <span className="brand-name">
              AllTrace<span className="brand-cn">寻迹</span>
            </span>
          </a>
          <nav aria-label="主导航">
            <a className="nav-active" href="#workspace">
              搜图工作台
            </a>
            <button onClick={() => setDialog('about')}>关于寻迹</button>
          </nav>
          <div className="header-tools">
            <button
              className="icon-button theme-button"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          </div>
        </div>
      </header>
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <img
            className="hero-photo"
            src="/assets/sakura.jpg"
            alt="蓝天下盛开的淡粉色樱花"
            fetchPriority="high"
          />
          <div className="hero-wash" />
          <div className="hero-content">
            <div className="hero-kicker">
              <span /> A LITTLE IMAGE, A WHOLE NEW WORLD
            </div>
            <h1 id="hero-title">
              从一张图，
              <br className="mobile-break" />
              找到<span>心动的出处</span>。
            </h1>
            <p>
              那一帧动画、那一张插画、那个念念不忘的角色。
              <br />
              把图片交给寻迹，让故事再次相遇。
            </p>
            <div className="hero-tags">
              <span>
                <FilmStrip size={15} />
                动画溯源
              </span>
              <span>
                <PaintBrush size={15} />
                插画寻踪
              </span>
              <span>
                <UserFocus size={15} />
                角色识别
              </span>
            </div>
          </div>
          <div className="hero-side">
            <span className="japanese-title">好き、のつづきを。</span>
            <span className="hero-stamp">
              <Flower size={20} weight="duotone" />
              寻找故事的下一页
            </span>
          </div>
          <span className="hero-petal petal-one" />
          <span className="hero-petal petal-two" />
        </section>
        <div className="workspace" id="workspace">
          <aside className="upload-column">
            <section className="upload-panel">
              <div className="section-heading">
                <h2>
                  <ImageIcon size={20} weight="duotone" />
                  开始寻迹
                </h2>
                <span className="tiny-label">YOUR IMAGE</span>
              </div>
              <div className="input-tabs" role="tablist" aria-label="图片来源">
                <button
                  role="tab"
                  aria-selected={inputMode === 'file'}
                  onClick={() => {
                    setInputMode('file');
                    setError('');
                  }}
                >
                  <UploadSimple size={15} />
                  上传图片
                </button>
                <button
                  role="tab"
                  aria-selected={inputMode === 'url'}
                  onClick={() => {
                    setInputMode('url');
                    setError('');
                  }}
                >
                  <LinkIcon size={15} />
                  图片链接
                </button>
              </div>
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                aria-label="选择图片文件"
                onChange={(e) => {
                  void chooseFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {inputMode === 'file' ? (
                image ? (
                  <div
                    className="selected-image"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void chooseFile(e.dataTransfer.files[0]);
                    }}
                  >
                    <img src={image.preview} alt="待识别图片预览" />
                    <div className="image-overlay">
                      <button onClick={() => fileInput.current?.click()}>
                        <ArrowClockwise size={14} />
                        更换图片
                      </button>
                      <button onClick={clearImage} aria-label="移除图片">
                        <Trash size={15} />
                      </button>
                    </div>
                    <div className="image-info">
                      <span title={image.file.name}>{image.file.name}</span>
                      <small>
                        {image.width} × {image.height} · {(image.file.size / 1024).toFixed(0)} KB
                      </small>
                    </div>
                  </div>
                ) : (
                  <button
                    className={'dropzone ' + (dragging ? 'dragging' : '')}
                    onClick={() => fileInput.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      void chooseFile(e.dataTransfer.files[0]);
                    }}
                    disabled={preparing}
                  >
                    <span className="upload-illustration">
                      <ImageIcon className="back-photo" size={55} weight="duotone" />
                      <ImageIcon className="front-photo" size={61} weight="duotone" />
                      <span className="upload-plus">+</span>
                      <Sparkle className="upload-spark" size={16} />
                    </span>
                    <strong>
                      {preparing
                        ? '正在整理图片…'
                        : dragging
                          ? '松开，把图片交给寻迹'
                          : '把心动的画面放在这里'}
                    </strong>
                    <span className="dropzone-description">
                      拖拽图片到此处，或 <em>点击上传</em>
                    </span>
                    <span className="paste-hint">
                      也可以直接 <kbd>Ctrl</kbd> + <kbd>V</kbd> 粘贴
                    </span>
                    <span className="file-types">JPG / PNG / WebP / GIF · 最大 8 MB</span>
                  </button>
                )
              ) : (
                <div className="url-panel">
                  <LinkIcon size={35} weight="duotone" />
                  <label htmlFor="image-url">粘贴图片链接</label>
                  <input
                    id="image-url"
                    type="url"
                    placeholder="https://example.com/image.jpg"
                    value={urlValue}
                    onChange={(e) => setUrlValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !busy && configStatus === 'ready') beginSearch();
                    }}
                  />
                  <p>
                    需要公开可访问的 HTTPS 图片直链，
                    <br />
                    不支持网页链接或需要登录的图片。
                    {selected.includes('soutubot') && (
                      <>
                        <br />
                        搜图 Bot 酱会由 Worker 取回图片链接后提交。
                      </>
                    )}
                  </p>
                </div>
              )}
              <div className="engine-selection-heading">
                <h3>
                  选择搜索引擎{' '}
                  <span>
                    {selected.length} / {engines.length}
                  </span>
                </h3>
                <button
                  onClick={() =>
                    setSelected(
                      selected.length === availableEngineIds.length ? [] : availableEngineIds,
                    )
                  }
                >
                  {selected.length === availableEngineIds.length ? '取消全选' : '全选'}
                </button>
              </div>
              <div className="engine-selection">
                {engines.map((engine) => (
                  <label
                    className={'engine-option ' + (selected.includes(engine.id) ? 'checked' : '')}
                    key={engine.id}
                    title={
                      availableEngineIds.includes(engine.id) ? undefined : '请先开启外部搜索引擎'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(engine.id)}
                      disabled={!availableEngineIds.includes(engine.id)}
                      onChange={() =>
                        setSelected((prev) =>
                          prev.includes(engine.id)
                            ? prev.filter((id) => id !== engine.id)
                            : [...prev, engine.id],
                        )
                      }
                    />
                    <EngineMark engine={engine} small />
                    <span>{engine.name}</span>
                    <span className="checkbox-display">
                      {selected.includes(engine.id) && <Check size={11} weight="bold" />}
                    </span>
                  </label>
                ))}
              </div>
              <div className="browser-toggles">
                <label className="thumbnail-toggle browser-toggle">
                  <span className="thumbnail-toggle-label">外部搜索 SauceNAO</span>
                  <input
                    type="checkbox"
                    aria-label="外部搜索 SauceNAO"
                    checked={sauceBrowser}
                    onChange={(event) => setSauceBrowser(event.target.checked)}
                  />
                  <span className="toggle-track" aria-hidden="true">
                    <span />
                  </span>
                </label>
                <label
                  className="thumbnail-toggle browser-toggle"
                  title="允许浏览器打开外部搜索引擎"
                >
                  <span className="thumbnail-toggle-label">外部搜索引擎</span>
                  <input
                    type="checkbox"
                    aria-label="允许浏览器打开外部搜索引擎"
                    checked={browserEnabled}
                    onChange={(event) => setBrowserEnabled(event.target.checked)}
                  />
                  <span className="toggle-track" aria-hidden="true">
                    <span />
                  </span>
                </label>
              </div>
              {engines.map((engine) => {
                const state = states[engine.id];
                if (state.mode !== 'browser' || state.status !== 'error') return null;
                return (
                  <p className="form-error" role="alert" key={engine.id}>
                    <Info size={16} />
                    <span>
                      {engine.name}：{state.error}{' '}
                      {state.searchUrl ? (
                        <a href={state.searchUrl} target="_blank" rel="noopener noreferrer">
                          在浏览器打开
                        </a>
                      ) : (
                        <button onClick={() => retry(engine.id)}>重试打开</button>
                      )}
                    </span>
                  </p>
                );
              })}
              {manualBrowserEngines.length > 0 && (
                <div className="browser-actions" role="status">
                  <p>
                    <Info size={16} />
                    移动端一次只能自动打开一个外部引擎，其余请按需继续：
                  </p>
                  <div>
                    {manualBrowserEngines.map((engine) => (
                      <a
                        key={engine.id}
                        href={states[engine.id].searchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <EngineMark engine={engine} small />
                        {engine.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {error && (
                <p className="form-error" role="alert">
                  <Info size={16} />
                  {error}
                </p>
              )}
              {configStatus === 'error' && (
                <p className="form-error" role="alert">
                  无法连接 Worker。<button onClick={() => void loadConfig()}>重新连接</button>
                </p>
              )}
              <button
                className="search-button"
                onClick={busy ? cancelSearch : beginSearch}
                disabled={preparing || configStatus !== 'ready'}
              >
                {busy ? (
                  <>
                    <CircleNotch size={19} className="spin" />
                    停止搜索
                  </>
                ) : (
                  <>
                    <MagnifyingGlass size={19} weight="bold" />
                    {configStatus === 'loading' ? '正在连接服务…' : '开始寻迹'}
                  </>
                )}
              </button>
            </section>
          </aside>
          <section className="results-section" aria-labelledby="results-title">
            <div className="results-heading">
              <div>
                <h2 id="results-title">线索收集处</h2>
                {(busy || hasSearched) && (
                  <p aria-live="polite">
                    {busy
                      ? '正在收集线索，已处理 ' + completed + ' / ' + activeCount + ' 个引擎'
                      : '收集到 ' +
                        totalMatches +
                        ' 条线索' +
                        (openedCount ? ' · 已打开 ' + openedCount + ' 个外站' : '')}
                  </p>
                )}
              </div>
              {hasSearched ? (
                <button className="clear-button" onClick={cancelSearch}>
                  <ArrowClockwise size={14} />
                  重置结果
                </button>
              ) : (
                <span className="results-hint">
                  <span />
                  准备好就出发
                </span>
              )}
            </div>
            <div className="result-tabs" role="tablist" aria-label="搜索结果分类">
              {categories.map((c) => (
                <button
                  role="tab"
                  aria-selected={category === c.id}
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                  {c.id === 'all' && <span>{resultEngines.length}</span>}
                </button>
              ))}
              <label className="thumbnail-toggle">
                <span className="thumbnail-toggle-label">
                  <Eye size={15} />
                  显示缩略图
                </span>
                <input
                  type="checkbox"
                  aria-label="显示 SauceNAO 和搜图 Bot 酱的缩略图"
                  checked={showThumbnails}
                  onChange={(event) => setShowThumbnails(event.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true">
                  <span />
                </span>
              </label>
            </div>
            <div className="results-grid">
              {resultEngines
                .filter((e) => category === 'all' || e.category === category)
                .map((engine) => (
                  <EngineCard
                    key={engine.id}
                    engine={engine}
                    state={states[engine.id]}
                    mode={modes[engine.id] || engine.mode}
                    input={activeInput}
                    showThumbnails={showThumbnails}
                    onRetry={() => retry(engine.id)}
                  />
                ))}
            </div>
          </section>
        </div>
        <div className="closing-note">
          <Flower size={17} weight="duotone" />
          <span>每一张图片背后，都有一个值得被发现的故事。</span>
          <Flower size={17} weight="duotone" />
        </div>
      </main>
      <footer className="site-footer">
        <span>
          <span className="footer-brand">AllTrace</span> 寻迹{' '}
          <span className="footer-divider">/</span> 为每一份热爱找到来处
        </span>
        <span className="footer-right">
          <span>
            <Cloud size={15} />
            Powered by Cloudflare Workers
          </span>
        </span>
      </footer>
      <dialog
        ref={dialogRef}
        className="info-dialog"
        onCancel={() => setDialog(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setDialog(null);
        }}
      >
        <div className="dialog-top">
          <span className="dialog-icon">
            <Heart size={25} weight="duotone" />
          </span>
          <button className="icon-button" onClick={() => setDialog(null)} aria-label="关闭说明">
            <X size={20} />
          </button>
        </div>
        <h2>关于 AllTrace 寻迹</h2>
        <div className="dialog-body">
          <p>AllTrace 是基于 Cloudflare Workers 的聚合识图工作台，与所列第三方服务没有隶属关系。</p>
          <h3>图片去哪儿了？</h3>
          <p>
            选择图片时仅在浏览器内预览。开始搜索后，各引擎经 Worker
            转发至所选服务；本站不使用数据库、对象存储或图床保存图片，不记录图片内容。Cloudflare
            与第三方仍受各自隐私政策约束。AnimeTrace 的候选作品名会发送给 AniList / Bangumi
            查询封面，不发送原图。
          </p>
          <h3>密钥与外部链接</h3>
          <p>
            API Key 仅保存于 Worker
            Secrets，不发送到浏览器。外站只在你点击后打开；图片链接会包含在第三方页面地址中。结果缩略图由第三方提供，加载时会向其发出图片请求。
          </p>
          <h3>关于结果</h3>
          <p>
            结果仅供参考，请尊重原作者版权。成人标记结果尽可能按上游字段过滤，但不保证所有引擎均能准确标记。搜图
            Bot 酱原站可能包含成人内容，请自行判断是否访问。
          </p>
          <h3>视觉素材</h3>
          <p>
            樱花照片来自{' '}
            <a href="https://unsplash.com" target="_blank" rel="noopener noreferrer">
              Unsplash
            </a>
            ，采用 Unsplash License。图标为 Phosphor Icons，西文字体为 Nunito Sans。
          </p>
        </div>
        <button className="dialog-confirm" onClick={() => setDialog(null)}>
          <CheckCircle size={18} />
          知道啦，开始寻迹
        </button>
      </dialog>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
