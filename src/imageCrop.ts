export type CropRect = { x: number; y: number; width: number; height: number };

export function cropPixels(rect: CropRect, width: number, height: number) {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    throw new Error('请框选有效的图片区域。');
  const x = Math.max(0, Math.min(width, Math.round(rect.x * width)));
  const y = Math.max(0, Math.min(height, Math.round(rect.y * height)));
  const right = Math.max(0, Math.min(width, Math.round((rect.x + rect.width) * width)));
  const bottom = Math.max(0, Math.min(height, Math.round((rect.y + rect.height) * height)));
  if (right <= x || bottom <= y) throw new Error('选区太小，请扩大后重试。');
  return { x, y, width: right - x, height: bottom - y };
}

// 每次都从上传原文件裁剪，避免反复调整时重采样、丢失局部细节。
export async function prepareImage(file: File, crop?: CropRect) {
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error('图片分辨率过高，请先缩小至 4000 万像素以内。');
    const area = cropPixels(
      crop ?? { x: 0, y: 0, width: 1, height: 1 },
      bitmap.width,
      bitmap.height,
    );
    const scale = Math.min(1, 2000 / Math.max(area.width, area.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(area.width * scale));
    canvas.height = Math.max(1, Math.round(area.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理此图片，请换用较新的浏览器。');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      bitmap,
      area.x,
      area.y,
      area.width,
      area.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob) throw new Error('图片读取失败，请重新选择。');
    return {
      file: new File([blob], file.name.replace(/\.[^.]+$/, '') + (crop ? '-crop' : '') + '.jpg', {
        type: 'image/jpeg',
      }),
      width: area.width,
      height: area.height,
    };
  } finally {
    bitmap.close();
  }
}
