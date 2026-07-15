import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Heartbeat } from "@phosphor-icons/react/dist/ssr";

export default function NiHealth({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Heartbeat className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
