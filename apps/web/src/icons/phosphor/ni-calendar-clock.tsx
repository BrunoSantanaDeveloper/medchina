import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { CalendarDots } from "@phosphor-icons/react/dist/ssr";

export default function NiCalendarClock({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <CalendarDots className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
