"use client";

import type { ComponentProps, MouseEvent, ReactNode } from "react";

type NavigationLinkProps = Omit<ComponentProps<"a">, "href" | "children"> & {
  href: string;
  children: ReactNode;
};

type VinextRouter = { push: (href: string) => unknown };

/** Use Vinext's mounted router without importing its hydration-breaking Link shim. */
export default function NavigationLink({ href, children, onClick, target, ...props }: NavigationLinkProps) {
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (target && target !== "_self")) return;

    const destination = new URL(href, window.location.href);
    if (destination.origin !== window.location.origin) return;

    const router = (window as Window & { next?: { router?: VinextRouter } }).next?.router;
    if (!router) return;

    event.preventDefault();
    try {
      Promise.resolve(router.push(`${destination.pathname}${destination.search}${destination.hash}`)).catch(() => window.location.assign(destination.href));
    } catch {
      window.location.assign(destination.href);
    }
  }

  return <a href={href} target={target} onClick={navigate} {...props}>{children}</a>;
}
