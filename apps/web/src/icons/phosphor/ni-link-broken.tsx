import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { LinkBreak } from "@phosphor-icons/react/dist/ssr";

export default function NiLinkBroken({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <LinkBreak className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
