import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Quotes } from "@phosphor-icons/react/dist/ssr";

export default function NiTextQuote({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Quotes className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
