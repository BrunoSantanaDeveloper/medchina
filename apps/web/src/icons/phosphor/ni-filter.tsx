import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Funnel } from "@phosphor-icons/react/dist/ssr";

export default function NiFilter({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Funnel className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
