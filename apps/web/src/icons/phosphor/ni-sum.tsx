import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Sigma } from "@phosphor-icons/react/dist/ssr";

export default function NiSum({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Sigma className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
