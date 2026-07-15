import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CloudRain } from "@phosphor-icons/react/dist/ssr";

export default function NiCloudRain({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CloudRain className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
