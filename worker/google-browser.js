// 直连拿到的经常只是 Google 的脚本重试页。浏览器只打开这次上传得到的结果地址，
// 让页面自己完成跳转。不打开验证码或 enablejs 地址，不点击验证，也不写入登录 Cookie。
import puppeteer from '@cloudflare/puppeteer';

const RESULT_HOSTS = new Set(['www.google.com', 'lens.google.com']);
const SESSION_COOKIE_NAMES = new Set(['NID', 'AEC', 'SOCS']);

export function googleResultUrl(value) {
  try {
    const url = new URL(value);
    const blocked = /showcaptcha|\/sorry\/|\/httpservice\/retry\/enablejs/i;
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443') ||
      !RESULT_HOSTS.has(url.hostname) ||
      blocked.test(url.pathname + url.search)
    )
      return '';
    return url.href;
  } catch {
    return '';
  }
}

// 只延续本次匿名上传的会话，明确排除 SID 一类登录 Cookie。
export function googleSessionCookies(cookies) {
  return (Array.isArray(cookies) ? cookies : []).flatMap((cookie) => {
    const name = String(cookie?.name || '');
    const value = String(cookie?.value || '');
    const domain = String(cookie?.domain || '')
      .replace(/^\./, '')
      .toLowerCase();
    if (!SESSION_COOKIE_NAMES.has(name) || !value || value.length > 4096) return [];
    if (domain !== 'google.com' && !domain.endsWith('.google.com')) return [];
    return [
      {
        name,
        value,
        domain: '.google.com',
        path: typeof cookie.path === 'string' && cookie.path.startsWith('/') ? cookie.path : '/',
        secure: true,
        httpOnly: true,
      },
    ];
  });
}

export async function renderGooglePage(browserBinding, url, signal, cookies = []) {
  const target = googleResultUrl(url);
  if (!target) throw new Error('拒绝用浏览器打开未授权或验证地址。');
  if (signal?.aborted) throw new Error('搜索超时，请重试。');
  const browser = await puppeteer.launch(browserBinding);
  const close = () => browser.close().catch(() => {});
  if (signal) signal.addEventListener('abort', close, { once: true });
  try {
    const page = await browser.newPage();
    const session = googleSessionCookies(cookies);
    // 没有会话 Cookie 时仍打开带 vsrid 的结果地址；设置失败不改走验证流程。
    if (session.length) await page.setCookie(...session).catch(() => {});
    page.setDefaultTimeout(20000);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page
      .waitForFunction(
        () => {
          const html = document.documentElement?.innerHTML || '';
          const title = document.title || '';
          if (/captcha|robot check|just a moment|unusual traffic/i.test(title)) return true;
          if (
            document.querySelector(
              '#captcha, #recaptcha, .N54PNb, .G19kAf.ENn9pd, .vEWxFf, [data-item-id]',
            )
          )
            return true;
          return html.includes('AF_initDataCallback') && !/SG_REL|window\.sgs/.test(html);
        },
        { timeout: 12000, polling: 250 },
      )
      .catch(() => {});
    return { html: await page.content(), url: page.url() };
  } finally {
    if (signal) signal.removeEventListener('abort', close);
    await close();
  }
}
