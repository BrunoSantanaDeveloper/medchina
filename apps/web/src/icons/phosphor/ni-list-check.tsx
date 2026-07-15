import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ListChecks } from "@phosphor-icons/react/dist/ssr";

export default function NiListCheck({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ListChecks className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
