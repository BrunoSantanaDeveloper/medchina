import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Watch } from "@phosphor-icons/react/dist/ssr";

export default function NiWatch({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Watch className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
