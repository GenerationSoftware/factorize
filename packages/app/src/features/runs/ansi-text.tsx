import { useMemo } from "react";
import { parseAnsi } from "./ansi";
export function AnsiText({ text }: { text: string }) {
  const tokens = useMemo(() => parseAnsi(text), [text]);
  return tokens.map((token, index) => <span key={index} style={token.style}>{token.text}</span>);
}
