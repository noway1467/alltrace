import { useEffect, useState } from 'react';
import {
  ArrowClockwise,
  ArrowRight,
  ArrowUpRight,
  CircleNotch,
  Eye,
  EyeSlash,
  FilmStrip,
  GlobeHemisphereWest,
  Info,
  ImageSquare,
  MagnifyingGlass,
  PaintBrush,
  Sparkle,
  UserFocus,
  Binoculars,
} from '@phosphor-icons/react';
import {
  externalLink,
  type Engine,
  type Result,
  type SearchInput,
  type SearchState,
} from './engines';
export const engineIcons = {
  trace: FilmStrip,
  saucenao: PaintBrush,
  animetrace: UserFocus,
  google: GlobeHemisphereWest,
  yandex: Eye,
  soutubot: Sparkle,
  ascii2d: ImageSquare,
  baidu: MagnifyingGlass,
  iqdb: Binoculars,
};
export function EngineMark({ engine, small = false }: { engine: Engine; small?: boolean }) {
  const Icon = engineIcons[engine.id];
  return (
    <span className={'engine-mark ' + engine.color + (small ? ' small' : '')}>
      <Icon size={small ? 18 : 24} weight="duotone" />
    </span>
  );
}
function ResultRow({
  result,
  engine,
  thumbnailsEnabled,
  preferenceControlled,
}: {
  result: Result;
  engine: Engine;
  thumbnailsEnabled: boolean;
  preferenceControlled: boolean;
}) {
  const [revealed, setRevealed] = useState(false),
    [broken, setBroken] = useState(false);
  const Icon = engineIcons[engine.id];
  const hiddenByPreference = preferenceControlled && !thumbnailsEnabled;
  const hidden = hiddenByPreference || (!preferenceControlled && result.sensitive && !revealed);
  const label = result.thumbnailKind || '匹配图片';
  return (
    <div className="match-row">
      <div className={'match-picture ' + (label.includes('封面') ? 'cover-picture' : '')}>
        {hiddenByPreference ? (
          <span className="missing-image">
            <EyeSlash size={22} />
            <span>缩略图已关闭</span>
          </span>
        ) : hidden ? (
          <button
            className="reveal-image"
            onClick={() => setRevealed(true)}
            aria-label={'显示可能敏感的缩略图：' + result.title}
          >
            <Eye size={18} />
            <span>显示缩略图</span>
          </button>
        ) : result.thumbnail && !broken ? (
          <img
            src={result.thumbnail}
            alt={label + '：' + result.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="missing-image">
            <Icon size={22} />
            <span>
              {broken ? '图片加载失败' : engine.id === 'animetrace' ? '封面暂缺' : '图片暂缺'}
            </span>
          </span>
        )}
      </div>
      <a
        className="match-link"
        title={result.title + ' · ' + result.subtitle}
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <div className="match-copy">
          <strong>{result.displayTitle || result.title}</strong>
          <span>{result.subtitle}</span>
          <small>
            {result.scoreLabel ||
              (result.similarity === null
                ? '来源候选'
                : result.similarity.toFixed(1) +
                  '% 相似' +
                  (engine.id === 'trace' && result.similarity < 90 ? ' · 低相似度，仅供参考' : ''))}
          </small>
          {result.thumbnailKind && (
            <span className="thumbnail-label">
              {result.thumbnailKind}
              {result.sensitive ? ' · 可能敏感' : ''}
            </span>
          )}
        </div>
        <ArrowUpRight size={16} />
      </a>
    </div>
  );
}
export function EngineCard({
  engine,
  state,
  mode,
  input,
  showThumbnails,
  onRetry,
}: {
  engine: Engine;
  state: SearchState;
  mode: string;
  input: SearchInput | null;
  showThumbnails: boolean;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [state.status]);
  const Icon = engineIcons[engine.id];
  const statusText = {
    idle: '等待图片',
    loading: '搜索中',
    success: state.results?.length
      ? state.results.length + (engine.id === 'animetrace' ? ' 个候选' : ' 个结果')
      : '暂无匹配',
    error: '搜索失败',
    attention: '需要浏览器',
    skipped: '未选择',
  }[state.status];
  const results = state.results || [];
  const preferenceControlled = engine.id === 'saucenao' || engine.id === 'soutubot';
  return (
    <article className={'result-card ' + engine.color + ' state-' + state.status}>
      <div className="card-heading">
        <div className="engine-title">
          <EngineMark engine={engine} />
          <div>
            <h3>{engine.name}</h3>
            <span>{engine.detail}</span>
          </div>
        </div>
        <span className={'status-badge ' + state.status}>
          {state.status === 'loading' && <CircleNotch className="spin" size={12} />}
          {statusText}
        </span>
      </div>
      {state.status === 'success' && results.length ? (
        <div className="matches">
          {(expanded ? results : results.slice(0, 2)).map((result, index) => (
            <ResultRow
              key={result.url + result.title + index}
              result={result}
              engine={engine}
              thumbnailsEnabled={showThumbnails}
              preferenceControlled={preferenceControlled}
            />
          ))}
          {results.length > 2 && (
            <button className="expand-button" onClick={() => setExpanded(!expanded)}>
              {expanded ? '收起结果' : '展开其余 ' + (results.length - 2) + ' 个结果'}
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      ) : state.status === 'error' ? (
        <div className="card-message error-message">
          <Info size={26} weight="duotone" />
          <strong>这个引擎尚未完成搜索</strong>
          <p>{state.error}</p>
          <button className="text-button" onClick={onRetry}>
            <ArrowClockwise size={14} />
            重新尝试
          </button>
        </div>
      ) : state.status === 'attention' ? (
        <div className="card-message attention-message">
          <Info size={28} weight="duotone" />
          <strong>
            {state.note?.includes('你的浏览器') || state.note?.includes('已打开')
              ? '已用你的浏览器打开'
              : '尚未取得可展示的图片结果'}
          </strong>
          <p>{state.note}</p>
          {state.searchUrl && (
            <a
              className="external-cta"
              href={state.searchUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开本次检索
              <ArrowUpRight size={15} />
            </a>
          )}
        </div>
      ) : state.status === 'loading' ? (
        <div className="card-message loading-message">
          <span className="search-orbit">
            <MagnifyingGlass size={28} />
          </span>
          <strong>正在检索图片与来源</strong>
          <p>请求已发送，请稍等一下…</p>
          <div className="loading-line" />
        </div>
      ) : (
        <div className="card-message idle-message">
          <Icon size={35} weight="duotone" />
          <strong>
            {state.status === 'success'
              ? '还没有找到合适的线索'
              : state.status === 'skipped'
                ? '这次先休息一下'
                : engine.desc}
          </strong>
          <p>
            {state.status === 'success'
              ? '试试完整、清晰的图片，或换一个引擎。'
              : state.status === 'skipped'
                ? '选择此引擎后再次开始寻迹。'
                : engine.id === 'google'
                  ? '解析视觉匹配和网页来源'
                  : '上传图片后在这里查看结果'}
          </p>
        </div>
      )}
      {state.status === 'success' && state.note && (
        <p className="result-note provider-note">{state.note}</p>
      )}
      <div className="card-footer">
        <span className="api-label">
          <span className="connection-dot" />
          {mode}
          {state.duration != null ? ' · ' + (state.duration / 1000).toFixed(1) + 's' : ''}
        </span>
        <a
          href={state.searchUrl || externalLink(engine, input)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={'访问 ' + engine.name + ' 原站'}
        >
          {state.searchUrl ? '本次检索' : '访问原站'}
          <ArrowUpRight size={13} />
        </a>
      </div>
    </article>
  );
}
