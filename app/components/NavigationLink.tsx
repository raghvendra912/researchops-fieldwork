import type { ComponentProps, ReactNode } from "react";

type NavigationLinkProps = Omit<ComponentProps<"a">, "href" | "children"> & {
  href: string;
  children: ReactNode;
};

/** Vinext's production RSC prefetch currently fails; native navigation remains reliable. */
export default function NavigationLink({ href, children, ...props }: NavigationLinkProps) {
  return <a href={href} {...props}>{children}</a>;
}
