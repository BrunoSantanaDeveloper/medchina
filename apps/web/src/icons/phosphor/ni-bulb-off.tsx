import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { LightbulbFilament } from "@phosphor-icons/react/dist/ssr";

export default function NiBulbOff({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <LightbulbFilament
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
