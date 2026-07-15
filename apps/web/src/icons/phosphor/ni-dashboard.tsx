import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Gauge } from "@phosphor-icons/react/dist/ssr";

export default function NiDashboard({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return <Gauge className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />;
}
