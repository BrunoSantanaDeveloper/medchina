import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CloudSun } from "@phosphor-icons/react/dist/ssr";

export default function NiCloudPartly({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CloudSun className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
