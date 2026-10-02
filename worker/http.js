export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

// 不代理用户提供的 URL；同时拒绝内网地址，避免向上游传递危险的下载目标。
export function publicImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048)
    throw new ApiError('请输入有效的公开 HTTPS 图片链接。');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError('图片链接格式不正确。');
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !host.includes('.') ||
    /[\[\]:]/.test(host) ||
    /^\d+(\.\d+)*$/.test(host) ||
    /(?:^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host) ||
    /(?:nip\.io|sslip\.io|localtest\.me)$/.test(host)
  ) {
    throw new ApiError('请使用公开网站的 HTTPS 图片链接，不支持内网地址或特殊端口。');
  }
  url.hash = '';
  return url.href;
}

export function safeLink(value) {
  try {
    return publicImageUrl(value);
  } catch {
    return '';
  }
}

export async function boundedBytes(body, limit) {
  if (!body) throw new ApiError('请求内容为空。');
  const reader = body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ApiError('图片或请求过大，请使用 8 MB 以内的图片。', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function detectImage(bytes) {
  if (bytes.length < 12) return '';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return 'image/png';
  const head = new TextDecoder().decode(bytes.slice(0, 12));
  if (/^GIF8[79]a/.test(head)) return 'image/gif';
  if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') return 'image/webp';
  return '';
}

export async function downloadImage(value, fetcher, signal) {
  let target = publicImageUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    let response;
    try {
      response = await fetcher(target, {
        method: 'GET',
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
        signal,
        redirect: 'manual',
      });
    } catch (error) {
      if (signal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError')
        throw new ApiError('图片链接下载超时，请稍后重试。', 504);
      throw new ApiError('无法下载图片链接，请确认链接公开可访问。', 502);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new ApiError('图片链接返回了无效跳转。', 502);
      try {
        target = publicImageUrl(new URL(location, target).href);
      } catch {
        throw new ApiError('图片链接跳转到了不安全的地址。', 502);
      }
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(`图片链接暂时不可用（HTTP ${response.status}）。`, 502);
    }
    const bytes = await boundedBytes(response.body, MAX_IMAGE_BYTES);
    const mime = detectImage(bytes);
    if (!mime) throw new ApiError('图片链接没有返回支持的 JPG、PNG、WebP 或 GIF 图片。', 415);
    return new Blob([bytes], { type: mime });
  }
  throw new ApiError('图片链接跳转次数过多。', 502);
}

export async function readInput(request) {
  const declaredSize = Number(request.headers.get('content-length'));
  if (declaredSize > MAX_BODY_BYTES) throw new ApiError('图片不能超过 8 MB。', 413);
  const type = request.headers.get('content-type') || '';
  if (!type.startsWith('multipart/form-data') && !type.startsWith('application/json')) {
    throw new ApiError('不支持的请求格式。', 415);
  }
  const bytes = await boundedBytes(
    request.body,
    type.startsWith('application/json') ? 4096 : MAX_BODY_BYTES,
  );
  if (type.startsWith('application/json')) {
    let data;
    try {
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ApiError('请求 JSON 格式错误。');
    }
    return { url: publicImageUrl(data?.url) };
  }
  let form;
  try {
    form = await new Response(bytes, { headers: { 'Content-Type': type } }).formData();
  } catch {
    throw new ApiError('上传格式错误，请重新选择图片。');
  }
  const file = form.get('image');
  if (!(file instanceof Blob) || !file.size) throw new ApiError('请选择一张图片。');
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError('图片不能超过 8 MB。', 413);
  const mime = detectImage(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!mime) throw new ApiError('仅支持 JPG、PNG、WebP 和 GIF 图片。', 415);
  const width = Number(form.get('image_width'));
  const height = Number(form.get('image_height'));
  return {
    file: new Blob([file], { type: mime }),
    width: Number.isInteger(width) && width > 0 && width <= 50000 ? width : 0,
    height: Number.isInteger(height) && height > 0 && height <= 50000 ? height : 0,
  };
}

export function imageForm(input) {
  const form = new FormData();
  if (input.file) form.set('file', input.file, 'image.' + input.file.type.split('/')[1]);
  else form.set('url', input.url);
  return form;
}

export async function upstreamJson(fetcher, url, init, signal) {
  let response;
  // Workers 仅支持 follow/manual；禁止自动跟随，避免凭据被重定向到其他站点。
  try {
    response = await fetcher(url, { ...init, signal, redirect: 'manual' });
  } catch (error) {
    if (signal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError')
      throw new ApiError('搜索超时，请稍后重试或前往原站。', 504);
    throw new ApiError('暂时无法连接此搜索引擎，请稍后重试。', 502);
  }
  if (response.status === 429) throw new ApiError('此引擎的搜索额度暂时用完了，请稍后再试。', 429);
  if (response.status === 401 || response.status === 403)
    throw new ApiError('引擎拒绝访问，请检查 API Key、额度或前往原站。', 502);
  if (!response.ok) throw new ApiError(`此引擎暂时不可用（HTTP ${response.status}）。`, 502);
  try {
    const bytes = await boundedBytes(response.body, 2 * 1024 * 1024);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError('此引擎返回了无法解析的数据，请稍后重试。', 502);
  }
}
