import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Terminal } from "@phosphor-icons/react/dist/ssr";

export default function NiTerminal({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Terminal className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
