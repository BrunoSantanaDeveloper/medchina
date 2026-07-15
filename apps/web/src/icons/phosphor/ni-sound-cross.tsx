import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { SpeakerX } from "@phosphor-icons/react/dist/ssr";

export default function NiSoundCross({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <SpeakerX className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
