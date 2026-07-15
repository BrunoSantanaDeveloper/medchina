import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Question } from "@phosphor-icons/react/dist/ssr";

export default function NiQuestionHexagon({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Question className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
