import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { BookmarkSimple } from "@phosphor-icons/react/dist/ssr";

export default function NiBookmark({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <BookmarkSimple
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
