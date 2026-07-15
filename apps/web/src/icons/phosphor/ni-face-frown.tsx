import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SmileySad } from "@phosphor-icons/react/dist/ssr";

export default function NiFaceFrown({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SmileySad className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
