import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { ArrowClockwise, Crop, X } from '@phosphor-icons/react';
import { cropPixels, type CropRect } from './imageCrop';

type Props = {
  image: { preview: string; width: number; height: number };
  initialCrop: CropRect | null;
  preparing: boolean;
  error: string;
  onApply: (crop: CropRect) => Promise<boolean>;
  onClose: () => void;
};
type Point = { x: number; y: number };
type Gesture = { id: number; mode: string; start: Point; rect: CropRect };
const fullImage = { x: 0, y: 0, width: 1, height: 1 };
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function ImageCropDialog({ image, initialCrop, preparing, error, onApply, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [rect, setRect] = useState<CropRect>(
    initialCrop ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  );
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  let size: ReturnType<typeof cropPixels> | null = null;
  try {
    size = cropPixels(rect, image.width, image.height);
  } catch {
    /* 拖动经过零面积时暂不允许确认。 */
  }

  function point(event: PointerEvent<HTMLDivElement>): Point {
    const bounds = stage.current!.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    if (preparing || !ready || gesture.current || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const target = event.target as HTMLElement;
    const mode =
      target.closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle ??
      (target.closest('.crop-selection') ? 'move' : 'draw');
    gesture.current = { id: event.pointerId, mode, start: point(event), rect };
    stage.current!.setPointerCapture(event.pointerId);
    stage.current!.focus();
    setDragging(true);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const action = gesture.current;
    if (!action || event.pointerId !== action.id) return;
    const current = point(event);
    const dx = current.x - action.start.x,
      dy = current.y - action.start.y;
    const previous = action.rect;
    if (action.mode === 'draw') {
      setRect({
        x: Math.min(action.start.x, current.x),
        y: Math.min(action.start.y, current.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      });
    } else if (action.mode === 'move') {
      setRect({
        ...previous,
        x: clamp(previous.x + dx, 0, 1 - previous.width),
        y: clamp(previous.y + dy, 0, 1 - previous.height),
      });
    } else {
      const bounds = stage.current!.getBoundingClientRect();
      const minWidth = Math.min(previous.width, 12 / bounds.width);
      const minHeight = Math.min(previous.height, 12 / bounds.height);
      let left = previous.x,
        top = previous.y,
        right = left + previous.width,
        bottom = top + previous.height;
      if (action.mode.includes('w')) left = clamp(left + dx, 0, right - minWidth);
      if (action.mode.includes('e')) right = clamp(right + dx, left + minWidth, 1);
      if (action.mode.includes('n')) top = clamp(top + dy, 0, bottom - minHeight);
      if (action.mode.includes('s')) bottom = clamp(bottom + dy, top + minHeight, 1);
      setRect({ x: left, y: top, width: right - left, height: bottom - top });
    }
  }
  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const action = gesture.current;
    if (!action || action.id !== event.pointerId) return;
    const current = point(event);
    const bounds = stage.current!.getBoundingClientRect();
    if (
      cancelled ||
      (action.mode === 'draw' &&
        (Math.abs(current.x - action.start.x) * bounds.width < 3 ||
          Math.abs(current.y - action.start.y) * bounds.height < 3))
    )
      setRect(action.rect);
    else move(event);
    gesture.current = null;
    setDragging(false);
    if (stage.current!.hasPointerCapture(event.pointerId))
      stage.current!.releasePointerCapture(event.pointerId);
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (
      preparing ||
      !ready ||
      dragging ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return;
    event.preventDefault();
    const dx = event.key === 'ArrowLeft' ? -0.01 : event.key === 'ArrowRight' ? 0.01 : 0;
    const dy = event.key === 'ArrowUp' ? -0.01 : event.key === 'ArrowDown' ? 0.01 : 0;
    setRect((previous) =>
      event.shiftKey
        ? {
            ...previous,
            width: clamp(previous.width + dx, Math.min(0.01, 1 - previous.x), 1 - previous.x),
            height: clamp(previous.height + dy, Math.min(0.01, 1 - previous.y), 1 - previous.y),
          }
        : {
            ...previous,
            x: clamp(previous.x + dx, 0, 1 - previous.width),
            y: clamp(previous.y + dy, 0, 1 - previous.height),
          },
    );
  }
  return (
    <dialog
      ref={dialog}
      className="crop-dialog"
      aria-labelledby="crop-title"
      aria-describedby="crop-help"
      onCancel={(event) => {
        event.preventDefault();
        if (!preparing) onClose();
      }}
    >
      <div className="crop-heading">
        <h2 id="crop-title">
          <Crop size={22} />
          选区搜图
        </h2>
        <button
          className="icon-button"
          aria-label="关闭选区"
          disabled={preparing}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p id="crop-help">拖动框选要搜索的部分，拖动选框可移动，四角可调整大小。</p>
      <div className="crop-canvas">
        <div
          ref={stage}
          className="crop-stage"
          role="group"
          tabIndex={0}
          aria-label="图片选区"
          aria-describedby="crop-keyboard"
          onKeyDown={keyboard}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={(event) => finish(event)}
          onPointerCancel={(event) => finish(event, true)}
          onLostPointerCapture={(event) => {
            if (gesture.current) finish(event, true);
          }}
        >
          <img
            src={image.preview}
            alt="框选待搜索的原图区域"
            draggable={false}
            onLoad={() => setReady(true)}
            onError={() => setLoadError(true)}
          />
          {ready && (
            <div
              className="crop-selection"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
            >
              <div className="crop-grid" aria-hidden="true" />
              {['nw', 'ne', 'sw', 'se'].map((corner) => (
                <span
                  key={corner}
                  className={`crop-handle crop-handle-${corner}`}
                  data-crop-handle={corner}
                  aria-hidden="true"
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="crop-details">
        <span role="status">{size ? `${size.width} × ${size.height} 像素` : '请扩大选区'}</span>
        <button disabled={preparing || !ready || dragging} onClick={() => setRect(fullImage)}>
          <ArrowClockwise size={14} />
          选择整图
        </button>
      </div>
      <p id="crop-keyboard" className="crop-keyboard">
        方向键移动 · Shift + 方向键调整大小
      </p>
      {(error || loadError) && (
        <p className="form-error" role="alert">
          {loadError ? '图片预览加载失败，请关闭后重新选择图片。' : error}
        </p>
      )}
      <div className="crop-footer">
        <button className="crop-cancel" disabled={preparing} onClick={onClose}>
          取消
        </button>
        <button
          className="crop-confirm"
          disabled={preparing || !ready || !size || dragging}
          onClick={async () => {
            if (await onApply(rect)) onClose();
          }}
        >
          {preparing ? '正在裁剪…' : '使用选区'}
        </button>
      </div>
    </dialog>
  );
}
