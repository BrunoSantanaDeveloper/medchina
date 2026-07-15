import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { FlowArrow } from "@phosphor-icons/react/dist/ssr";

export default function NiDiagram({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <FlowArrow className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
