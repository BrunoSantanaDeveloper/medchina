import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { ChatCircleDots } from "@phosphor-icons/react/dist/ssr";

export default function NiMessageFilled({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <ChatCircleDots
      className={className}
      size={sizeHelper(size)}
      weight={variant === "contained" ? "fill" : "regular"}
    />
  );
}
