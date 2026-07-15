import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ChatCircleText } from "@phosphor-icons/react/dist/ssr";

export default function NiMessage({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ChatCircleText
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
