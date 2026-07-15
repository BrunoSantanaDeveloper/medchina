import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Calendar } from "@phosphor-icons/react/dist/ssr";

export default function NiCalendar({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Calendar className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
