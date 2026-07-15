import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Radio } from "@phosphor-icons/react/dist/ssr";

export default function NiRadio({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Radio className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
