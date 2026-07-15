import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Cursor } from "@phosphor-icons/react/dist/ssr";

export default function NiCursor({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Cursor className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
