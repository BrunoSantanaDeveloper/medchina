import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr";

export default function NiArrowHistory({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ClockCounterClockwise
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
