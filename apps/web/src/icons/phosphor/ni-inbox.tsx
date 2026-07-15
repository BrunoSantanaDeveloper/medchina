import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Tray } from "@phosphor-icons/react/dist/ssr";

export default function NiInbox({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Tray className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
