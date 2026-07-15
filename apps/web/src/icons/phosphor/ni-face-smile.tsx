import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Smiley } from "@phosphor-icons/react/dist/ssr";

export default function NiFaceSmile({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Smiley className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
