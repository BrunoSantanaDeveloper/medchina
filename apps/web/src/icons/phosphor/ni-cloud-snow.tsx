import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CloudSnow } from "@phosphor-icons/react/dist/ssr";

export default function NiCloudSnow({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CloudSnow className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
