import { useLayoutEffect, type ComponentProps } from "react";
import { Input } from "./ui";

/** Integration credentials are API secrets, not passwords for signing into Factorize. */
export function SecretInput(props: Omit<ComponentProps<typeof Input>, "type" | "autoComplete">) {
  return <Input {...props} type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} data-1p-ignore="true" data-op-ignore="true"/>;
}

/** Scope the password-manager opt-out to this page and restore it on navigation. */
export function useDisableCredentialAutofill() {
  useLayoutEffect(() => {
    const attributes = ["data-1p-ignore", "data-op-ignore"];
    const previous = attributes.map(name => document.body.getAttribute(name));
    attributes.forEach(name => document.body.setAttribute(name, "true"));
    return () => attributes.forEach((name, index) => {
      if (previous[index] === null) document.body.removeAttribute(name);
      else document.body.setAttribute(name, previous[index]!);
    });
  }, []);
}
