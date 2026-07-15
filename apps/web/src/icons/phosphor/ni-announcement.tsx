import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Megaphone } from "@phosphor-icons/react/dist/ssr";

export default function NiAnnouncement({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Megaphone className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
