import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { List } from "@phosphor-icons/react/dist/ssr";

export default function NiList({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <List className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
