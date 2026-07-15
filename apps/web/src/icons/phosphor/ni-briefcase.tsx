import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Briefcase } from "@phosphor-icons/react/dist/ssr";

export default function NiBriefcase({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Briefcase className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
