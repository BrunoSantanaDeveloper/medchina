import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { TextB } from "@phosphor-icons/react/dist/ssr";

export default function NiTextBold({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <TextB className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
