import { qrcode } from "@libs/qrcode";
import { useMemo } from "react";

type QRCodeProps = {
  value: string;
  size?: number;
  className?: string;
  alt?: string;
  href?: string;
  title?: string;
  wrapperClassName?: string;
};

export default function QRCode({
  value,
  size = 200,
  className,
  alt = "QR code",
  href,
  title,
  wrapperClassName,
}: QRCodeProps) {
  const svg = useMemo(() => qrcode(value, { output: "svg", border: 2 }), [value]);
  const code = (
    <div
      role="img"
      aria-label={alt}
      className={className}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );

  if (href) {
    return (
      <a href={href} title={title} className={wrapperClassName}>
        {code}
      </a>
    );
  }

  return code;
}
