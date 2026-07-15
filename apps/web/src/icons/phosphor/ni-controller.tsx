import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { GameController } from "@phosphor-icons/react/dist/ssr";

export default function NiController({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <GameController
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
