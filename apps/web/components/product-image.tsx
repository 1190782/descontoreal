import Image from "next/image";
import type { ReactElement } from "react";
import { isResizable } from "@/image-loader";

/** A product photo in a square box, straight from the store; an empty box when the product has none. */
export function ProductImage({
  src,
  alt,
  size,
  eager = false,
}: {
  src: string | null;
  alt: string;
  /** CSS pixels of the box. */
  size: number;
  /** The page's main image: load it first. */
  eager?: boolean;
}): ReactElement {
  if (src === null) {
    return (
      <div className="shrink-0 rounded-md bg-slate-100" style={{ width: size, height: size }} aria-hidden />
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      sizes={`${size}px`}
      unoptimized={!isResizable(src)}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      className="shrink-0 rounded-md bg-white object-contain"
      style={{ width: size, height: size }}
    />
  );
}
