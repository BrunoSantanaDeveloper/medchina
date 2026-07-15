import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Scales } from "@phosphor-icons/react/dist/ssr";

export default function NiScale({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Scales className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
