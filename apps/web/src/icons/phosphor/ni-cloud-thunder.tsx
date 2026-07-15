import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CloudLightning } from "@phosphor-icons/react/dist/ssr";

export default function NiCloudThunder({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CloudLightning
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
