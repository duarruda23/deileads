"use client";

import { useEffect } from "react";

/**
 * Sets the browser tab title for the current page.
 *
 * Every route under (dashboard) is a client component, so none of
 * them can use Next.js's server-only Metadata API (`export const
 * metadata`) to set their own `<title>` — only the root layout can,
 * which is why every dashboard page previously showed whatever title
 * was last set (in practice "wacrm", the root's default) regardless
 * of which page was open.
 *
 * A plain `document.title = ...` in a `useEffect` is NOT enough here:
 * Next's App Router owns a `<title>` node reconciled from the root
 * layout's `metadata` on every render pass, not just on navigation —
 * any unrelated re-render anywhere in the tree (an auth/profile fetch
 * settling, a toast appearing, anything) re-commits that node back to
 * "wacrm" and silently undoes a one-shot manual set. Confirmed live:
 * a `document.title` set from a normal effect (and even one delayed
 * a full macrotask) both got reverted within ~2s of mount.
 *
 * A `MutationObserver` on `document.head` is the practical fix —
 * it re-asserts our title every time something else changes the
 * `<title>` element, for as long as this page stays mounted.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const full = `${title} — wacrm`;

    function apply() {
      if (document.title !== full) document.title = full;
    }

    apply();

    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, characterData: true, childList: true });

    return () => observer.disconnect();
  }, [title]);
}
