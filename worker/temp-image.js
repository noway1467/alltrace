import { ApiError, detectImage } from './http.js';

const ID_PATTERN = /^[a-f0-9]{32}$/;

export async function publishTempImage(request, input, env) {
  if (!input.file) return input.url;
  if (!env.TEMP_IMAGES) throw new ApiError('暂时不能生成公开图片链接。', 503);
  const bytes = await input.file.arrayBuffer();
  const id = crypto.randomUUID().replaceAll('-', '');
  await env.TEMP_IMAGES.put(id, bytes, {
    expirationTtl: 600,
    metadata: { type: input.file.type || 'application/octet-stream' },
  });
  return new URL('/api/temp-image/' + id, request.url).href;
}

export async function readTempImage(request, env) {
  const id = new URL(request.url).pathname.match(/^\/api\/temp-image\/([a-f0-9]{32})$/)?.[1];
  if (!id || !ID_PATTERN.test(id) || !env.TEMP_IMAGES)
    return new Response('图片不存在。', { status: 404 });
  const stored = await env.TEMP_IMAGES.getWithMetadata(id, { type: 'arrayBuffer' });
  if (!stored?.value) return new Response('图片已过期。', { status: 404 });
  const type = detectImage(new Uint8Array(stored.value)) || 'application/octet-stream';
  return new Response(stored.value, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
