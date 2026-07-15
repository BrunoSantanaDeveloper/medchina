import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Phone } from "@phosphor-icons/react/dist/ssr";

export default function NiPhoneHandset({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Phone className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
