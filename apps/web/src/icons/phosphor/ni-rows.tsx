import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Rows } from "@phosphor-icons/react/dist/ssr";

export default function NiRows({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Rows className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
