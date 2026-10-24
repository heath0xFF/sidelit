export type DocumentFormat = "markdown" | "html" | "mdx";

export function formatForPath(path: string): DocumentFormat | undefined {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "mdx") return "mdx";
  return undefined;
}

export function isPreviewable(path: string) {
  return formatForPath(path) !== undefined;
}
