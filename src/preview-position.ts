export type ScrollAnchor = { selector: string; tag: string; text: string; top: number };
export type ScrollPosition = { x: number; y: number; anchor?: ScrollAnchor };
export type PreviewPosition = ScrollPosition & {
  url: string;
  containers: (ScrollPosition & { selector: string })[];
};

const positions = new Map<string, PreviewPosition>();
const coordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000_000;
const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

// Messages cross an untrusted iframe boundary. Retain only bounded view state.
export function parsePreviewPosition(value: unknown): PreviewPosition | undefined {
  const parse = (value: any): ScrollPosition | undefined => {
    if (!value || !coordinate(value.x) || !coordinate(value.y)) return;
    const result: ScrollPosition = { x: value.x, y: value.y };
    const a = value.anchor;
    if (a && bounded(a.selector, 500) && bounded(a.text, 160) && bounded(a.tag, 32) && /^[a-z][a-z0-9-]*$/.test(a.tag) && coordinate(a.top)) {
      result.anchor = { selector: a.selector, text: a.text, tag: a.tag, top: a.top };
    }
    return result;
  };
  const data = value as any;
  const position = parse(data);
  if (!position || !bounded(data.url, 4096) || !Array.isArray(data.containers) || data.containers.length > 8) return;
  const containers: PreviewPosition['containers'] = [];
  for (const item of data.containers) {
    const parsed = parse(item);
    if (parsed && bounded(item.selector, 500)) containers.push({ ...parsed, selector: item.selector });
  }
  return { ...position, url: data.url, containers };
}

export const previewPosition = (key: string) => positions.get(key);
export function rememberPreviewPosition(key: string, position: PreviewPosition) {
  positions.delete(key);
  positions.set(key, position);
  if (positions.size > 32) positions.delete(positions.keys().next().value!);
}
export const forgetPreviewPosition = (key: string) => positions.delete(key);
