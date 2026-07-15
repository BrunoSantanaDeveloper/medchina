import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Ticket } from "@phosphor-icons/react/dist/ssr";

export default function NiTicket({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Ticket className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
