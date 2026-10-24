import type { PreviewAsset } from './api';
import bridge from '../extensions/preview-bridge/sidelit.js?raw';
import proseFont from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2?inline';
import italicFont from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-italic.woff2?inline';
import monoFont from '@fontsource-variable/inconsolata/files/inconsolata-latin-wght-normal.woff2?inline';

type ReadAsset = (document: string, reference: string) => Promise<PreviewAsset>;
export const mdxStyle = `
@font-face{font-family:SidelitProse;src:url('${proseFont}');font-weight:100 900}@font-face{font-family:SidelitProse;src:url('${italicFont}');font-weight:100 900;font-style:italic}@font-face{font-family:SidelitMono;src:url('${monoFont}');font-weight:200 900}
body{margin:0;padding:32px max(24px,8%);color:#d5d6df;background:#333643;font:16px/1.6 SidelitProse,-apple-system,BlinkMacSystemFont,sans-serif}
html[data-theme=light] body{color:#363744;background:#fafafd}html[data-theme=light] pre{background:#eeeef4}html[data-theme=light] a{color:#6346c7}
html[data-theme=light] .tok-keyword{color:#a626a4}html[data-theme=light] .tok-string{color:#407840}html[data-theme=light] .tok-variableName{color:#b83a34}
html[data-theme=light] .tok-number,html[data-theme=light] .tok-bool,html[data-theme=light] .tok-typeName{color:#805500}html[data-theme=light] .tok-comment{color:#686a7c}
ul.contains-task-list{list-style:none;padding-left:1.2em}li.task-list-item input{margin-left:-1.2em}h1:first-child{margin-top:0}
h1,h2,h3{line-height:1.25}h1{font-size:2em}h2{margin-top:1.6em}a{color:#b4a7ff}img{max-width:100%}
pre,code{font-family:SidelitMono,ui-monospace,SFMono-Regular,monospace}pre{padding:16px;overflow:auto;background:#30323e;border-radius:6px}code{font-size:.95em}
table{border-collapse:collapse}th,td{border:1px solid #4b5260;padding:6px 12px}th{text-align:left}blockquote{margin-left:0;padding-left:16px;border-left:1px solid #4b5260}
.sidelit-callout,.sidelit-card{padding:12px 16px;border:1px solid #4b5260;margin:16px 0}.sidelit-badge{padding:2px 6px;background:#3e4451}.sidelit-stack{display:grid;gap:12px}
.tok-keyword{color:#d797e6}.tok-string{color:#98c379}.tok-number,.tok-bool{color:#d19a66}.tok-comment{color:#a5a7b8}.tok-variableName{color:#f08c95}.tok-typeName{color:#e5c07b}
`;
const isLocal = (ref: string) => !!ref && !/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(ref);
const fileUrl = (path: string) => 'file://' + path.split('/').map(encodeURIComponent).join('/');
const safeScript = (script: string) => script.replace(/<\/script/gi, '<\\/script');

export async function preparePreview(source: string, path: string, format: 'html' | 'mdx', scripts: boolean, runtime: string, read: ReadAsset) {
  let count = 0;
  let assetBytes = 0;
  const assets = new Map<string, Promise<PreviewAsset>>();
  const warnings: string[] = [];
  const asset = async (reference: string, base = path) => {
    if (++count > 256) throw new Error('Preview exceeds 256 local assets. Use a development server.');
    const key = new URL(reference, fileUrl(base)).href;
    if (assetBytes > 24 * 1024 * 1024) throw new Error('Preview asset budget exceeded. Use a development server.');
    if (!assets.has(key)) assets.set(key, read(path, key));
    const result = await assets.get(key)!;
    assetBytes += result.value.length;
    if (assetBytes > 24 * 1024 * 1024) throw new Error('Preview asset budget exceeded. Use a development server.');
    return result;
  };
  const image = async (ref: string, base = path) => {
    if (!isLocal(ref)) return ref;
    try { return (await asset(ref, base)).value; }
    catch (error) { warnings.push(`${ref}: ${String(error)}`); return 'data:,'; }
  };
  const css = async (text: string, base: string, depth = 0): Promise<string> => {
    if (depth > 8) throw new Error('Stylesheet import depth exceeded');
    const imports = [...text.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?\s*([^;]*);/gi)];
    for (const match of imports) {
      if (!isLocal(match[1])) { warnings.push('Remote CSS import blocked: ' + match[1]); text = text.replace(match[0], ''); continue; }
      try {
        const sheet = await asset(match[1], base);
        let content = await css(sheet.value, sheet.path, depth + 1);
        if (match[2].trim()) content = `@media ${match[2]}{${content}}`;
        text = text.replace(match[0], content);
      } catch (error) { warnings.push(String(error)); text = text.replace(match[0], ''); }
    }
    const matches = [...text.matchAll(/url\(\s*['"]?([^'"\)]+?)['"]?\s*\)/gi)];
    for (const match of matches) if (isLocal(match[1])) text = text.replace(match[0], `url("${await image(match[1], base)}")`);
    return text;
  };
  let code = '';
  if (format === 'mdx') code = await (await import('./mdx')).compileStandaloneMdx(source, ref => image(ref));
  const parsed = new DOMParser().parseFromString(format === 'mdx' ? '<div id="sidelit-root"></div>' : source, 'text/html');
  for (const node of [...parsed.querySelectorAll('base,iframe,frame,frameset,object,embed,portal,meta[http-equiv]')]) node.remove();
  for (const node of [...parsed.querySelectorAll('*')]) {
    for (const attr of [...node.attributes]) {
      if ((!scripts && /^on/i.test(attr.name)) || attr.name === 'srcdoc' || attr.name === 'nonce' || attr.name === 'integrity') node.removeAttribute(attr.name);
      if (/^(href|action|formaction)$/i.test(attr.name) && /^\s*(javascript|file|tauri|sidelit-preview):/i.test(attr.value)) node.removeAttribute(attr.name);
    }
  }
  for (const script of [...parsed.scripts]) {
    if (!scripts) { script.remove(); continue; }
    const src = script.getAttribute('src');
    if (src) {
      if (!isLocal(src)) { warnings.push('Remote script blocked: ' + src); script.remove(); continue; }
      try { script.textContent = safeScript((await asset(src)).value); script.removeAttribute('src'); }
      catch (error) { warnings.push(String(error)); script.remove(); }
    }
  }
  for (const link of [...parsed.querySelectorAll('link')]) {
    const href = link.getAttribute('href') || '';
    if (link.matches('[rel~="stylesheet"]') && !isLocal(href)) warnings.push('Remote stylesheet blocked: ' + href);
    if (!link.matches('[rel~="stylesheet"]') || !isLocal(href)) { link.remove(); continue; }
    try {
      const sheet = await asset(href); const style = parsed.createElement('style');
      style.textContent = await css(sheet.value, sheet.path); link.replaceWith(style);
    } catch (error) { warnings.push(String(error)); link.remove(); }
  }
  for (const element of [...parsed.querySelectorAll('img[src],source[src],video[poster]')]) {
    const name = element.hasAttribute('poster') ? 'poster' : 'src';
    element.setAttribute(name, await image(element.getAttribute(name) || ''));
  }
  for (const element of [...parsed.querySelectorAll('[srcset]')]) {
    const srcset = element.getAttribute('srcset')!;
    if (srcset.includes('data:')) continue;
    const entries = await Promise.all(srcset.split(',').map(async part => {
      const [ref, ...descriptor] = part.trim().split(/\s+/); return [await image(ref), ...descriptor].join(' ');
    }));
    element.setAttribute('srcset', entries.join(', '));
  }
  for (const style of [...parsed.querySelectorAll('style')]) style.textContent = await css(style.textContent || '', path);
  for (const element of [...parsed.querySelectorAll('[style]')]) element.setAttribute('style', await css(element.getAttribute('style')!, path));
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const csp = parsed.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
  csp.content = `default-src 'none'; script-src ${scripts || format === 'mdx' ? "'unsafe-inline' 'unsafe-eval'" : "'nonce-" + nonce + "'"}; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  parsed.head.prepend(csp);
  const addScript = (text: string, first = false) => { const script = parsed.createElement('script'); script.setAttribute('nonce', nonce); script.textContent = safeScript(text); if (first) csp.after(script); else parsed.body.append(script); };
  addScript(bridge, true);
  if (format === 'mdx') {
    const style = parsed.createElement('style'); style.textContent = mdxStyle; parsed.head.append(style);
    const data = parsed.createElement('script'); data.id = 'sidelit-mdx'; data.type = 'application/json'; data.textContent = JSON.stringify({ code }).replaceAll('<', '\\u003c'); parsed.body.append(data);
    addScript(runtime);
  }
  return { html: '<!doctype html>' + parsed.documentElement.outerHTML, warnings };
}
