import { ChromeBookmarkAdapter, toBookmarkNode } from "../chrome/bookmarks"
import type { BookmarkNode } from "../types"

/**
 * Firefox uses the shared WebExtensions adapter plus native separators.
 * `openInManager` is a no-op
 * because Firefox has no equivalent to `chrome://bookmarks/`.
 * The UI hides the "open in manager" button via `capabilities.openInManager`.
 */
export class FirefoxBookmarkAdapter extends ChromeBookmarkAdapter {
  async move(
    id: string,
    destination: { parentId?: string; index: number }
  ): Promise<void> {
    // Firefox's Places update takes the final index, whereas Chromium needs
    // the shared adapter's adjustment when moving forward in the same folder.
    await chrome.bookmarks.move(id, destination)
  }

  async createSeparator(
    parentId: string,
    index?: number
  ): Promise<BookmarkNode> {
    // Chrome's declarations omit Firefox's `type` extension. Keeping the
    // details in a variable preserves that field on the actual API request.
    const details = {
      parentId,
      type: "separator" as const,
      ...(index === undefined ? {} : { index }),
    }
    return toBookmarkNode(await chrome.bookmarks.create(details))
  }

  async openInManager(): Promise<void> {
    // intentional no-op — Firefox has no bookmarks manager deep-link
  }
}
