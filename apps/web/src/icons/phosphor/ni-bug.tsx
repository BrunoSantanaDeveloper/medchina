import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Bug } from "@phosphor-icons/react/dist/ssr";

export default function NiBug({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Bug className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
