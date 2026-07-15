import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { MusicNote } from "@phosphor-icons/react/dist/ssr";

export default function NiMusic({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <MusicNote className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
