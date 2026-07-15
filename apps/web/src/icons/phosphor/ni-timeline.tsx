import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ChartLine } from "@phosphor-icons/react/dist/ssr";

export default function NiTimeline({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ChartLine className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
