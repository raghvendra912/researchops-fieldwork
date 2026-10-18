import NextLink from "next/link";
import type { ComponentProps } from "react";

type NavigationLinkProps = ComponentProps<typeof NextLink>;

/** Shared client-side navigation keeps the application shell mounted between routes. */
export default function NavigationLink(props: NavigationLinkProps) {
  return <NextLink {...props} />;
}
