import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { PushPin } from "@phosphor-icons/react/dist/ssr";

export default function NiPushPin({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <PushPin className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
