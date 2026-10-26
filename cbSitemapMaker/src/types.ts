export interface SitemapNode {
  id: string
  name: string
  children: SitemapNode[]
}

export type UiToPluginMessage =
  | { type: 'ready' }
  | { type: 'resize-ui'; height: number }
  | { type: 'generate'; roots: SitemapNode[] }
  | { type: 'update'; targetId: string; roots: SitemapNode[] }
  | { type: 'clear-target' }

export type PluginToUiMessage =
  | { type: 'generated'; id: string }
  | { type: 'updated'; id: string }
  | { type: 'sitemap-selected'; id: string | null; name?: string; roots?: SitemapNode[] }
  | { type: 'error'; message: string }