const EXPLORER = 'https://stellar.expert/explorer/testnet/'

/**
 * A stamp's links come from the stamp itself, which a visitor can paste or edit. Only links to
 * the stellar.expert testnet explorer are shown as links.
 */
export function explorerHref(url: string | undefined): string | null {
  return url && url.startsWith(EXPLORER) && !/[\s"'<>]/.test(url) ? url : null
}
