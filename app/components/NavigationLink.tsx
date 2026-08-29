import type { ComponentProps, ReactNode } from "react";

type NavigationLinkProps = Omit<ComponentProps<"a">, "href" | "children"> & {
  href: string;
  children: ReactNode;
};

/** Use document navigation so routes remain reliable through reverse tunnels. */
export default function NavigationLink({ href, children, ...props }: NavigationLinkProps) {
  return <a href={href} {...props}>{children}</a>;
}
