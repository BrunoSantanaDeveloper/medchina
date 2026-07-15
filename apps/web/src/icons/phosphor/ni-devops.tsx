import { NextureIconsProps, sizeHelper } from "../nexture-icons";

// Aliased on purpose: Phosphor names this icon `Infinity`, which would shadow
// the JavaScript global of the same name.
import { Infinity as InfinityIcon } from "@phosphor-icons/react/dist/ssr";

export default function NiDevops({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <InfinityIcon className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
