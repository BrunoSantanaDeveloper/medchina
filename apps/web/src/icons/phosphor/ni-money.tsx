import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Money } from "@phosphor-icons/react/dist/ssr";

export default function NiMoney({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Money className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
