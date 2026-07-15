import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Fire } from "@phosphor-icons/react/dist/ssr";

export default function NiFire({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Fire className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
