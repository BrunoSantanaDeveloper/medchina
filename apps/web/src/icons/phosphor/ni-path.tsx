import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Path } from "@phosphor-icons/react/dist/ssr";

export default function NiPath({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Path className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
