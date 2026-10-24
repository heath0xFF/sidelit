export function localServerUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password) throw new Error('Use a localhost, 127.0.0.1, or [::1] HTTP(S) URL without credentials.');
  if (url.hostname === '127.0.0.1' && url.port === '1420') throw new Error('Port 1420 is reserved for Sidelit development. Choose your project server.');
  return url.href;
}
